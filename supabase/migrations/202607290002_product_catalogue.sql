begin;

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_site text not null
    check (source_site in ('a-matrix.ng', 'assetmatrixenergy.com')),
  status text not null default 'running'
    check (status in ('running', 'completed', 'partial', 'failed')),
  discovered_count integer not null default 0,
  upserted_count integer not null default 0,
  embedded_count integer not null default 0,
  failed_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  source_site text not null
    check (source_site in ('a-matrix.ng', 'assetmatrixenergy.com')),
  source_external_id text not null,
  source_url text not null unique,
  source_modified_at timestamptz,
  source_hash text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  slug text,
  name text not null,
  manufacturer text,
  model text,
  sku text,
  summary text not null default '',
  description text not null default '',
  technical_details jsonb not null default '{}'::jsonb,
  features text[] not null default '{}',
  applications text[] not null default '{}',
  categories text[] not null default '{}',
  image_url text,
  image_alt text,
  gallery jsonb not null default '[]'::jsonb,
  listed_price text not null default 'Quotation required',
  availability text not null default 'Availability requires confirmation',
  status text not null default 'published'
    check (status in ('published', 'draft', 'archived')),
  sync_locked boolean not null default false,
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_site, source_external_id)
);

comment on column public.catalog_products.sync_locked is
  'When true, automated sync preserves all editable product fields while still recording that the source item was seen.';
comment on column public.catalog_products.source_snapshot is
  'Latest normalized source payload retained for audit, repair, and deliberate manual merging.';

create table if not exists public.catalog_product_specs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null
    references public.catalog_products(id) on delete cascade,
  sync_key text not null,
  section text not null default 'Specifications',
  name text not null,
  value text not null,
  unit text,
  sort_order integer not null default 0,
  source_managed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, sync_key)
);

comment on column public.catalog_product_specs.source_managed is
  'False marks a manually created specification that catalogue sync must not replace or remove.';

create index if not exists catalog_products_source_idx
  on public.catalog_products (source_site, source_external_id);
create index if not exists catalog_products_status_idx
  on public.catalog_products (status, updated_at desc);
create index if not exists catalog_products_name_trgm_idx
  on public.catalog_products using gin (name extensions.gin_trgm_ops);
create index if not exists catalog_products_model_trgm_idx
  on public.catalog_products using gin (model extensions.gin_trgm_ops);
create index if not exists catalog_products_sku_trgm_idx
  on public.catalog_products using gin (sku extensions.gin_trgm_ops);
create index if not exists catalog_product_specs_product_idx
  on public.catalog_product_specs (product_id, sort_order);
create index if not exists catalog_product_specs_value_trgm_idx
  on public.catalog_product_specs using gin (value extensions.gin_trgm_ops);

alter table public.knowledge_documents
  add column if not exists product_id uuid
    references public.catalog_products(id) on delete set null;

create index if not exists knowledge_documents_product_idx
  on public.knowledge_documents (product_id);

create or replace function public.search_catalog_products(
  search_query text,
  result_limit integer default 4
)
returns table (
  id uuid,
  source_site text,
  source_external_id text,
  source_url text,
  name text,
  manufacturer text,
  model text,
  sku text,
  summary text,
  description text,
  technical_details jsonb,
  features text[],
  applications text[],
  categories text[],
  image_url text,
  image_alt text,
  listed_price text,
  availability text,
  specifications jsonb,
  rank double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with scored as (
    select
      products.*,
      greatest(
        similarity(lower(products.name), lower(search_query)) * 5,
        similarity(lower(coalesce(products.model, '')), lower(search_query)) * 7,
        similarity(lower(coalesce(products.sku, '')), lower(search_query)) * 8,
        similarity(
          lower(
            concat_ws(
              ' ',
              products.name,
              products.manufacturer,
              products.model,
              products.sku,
              products.summary,
              array_to_string(products.categories, ' ')
            )
          ),
          lower(search_query)
        ) * 3,
        coalesce((
          select max(
            similarity(
              lower(concat_ws(' ', specs.name, specs.value, specs.unit)),
              lower(search_query)
            ) * 2
          )
          from public.catalog_product_specs as specs
          where specs.product_id = products.id
        ), 0)
      ) as search_rank
    from public.catalog_products as products
    where
      products.status = 'published'
      and (
        lower(
          concat_ws(
            ' ',
            products.name,
            products.manufacturer,
            products.model,
            products.sku,
            products.summary,
            products.description,
            array_to_string(products.categories, ' ')
          )
        ) % lower(search_query)
        or lower(products.name) like '%' || lower(search_query) || '%'
        or lower(coalesce(products.model, '')) like '%' || lower(search_query) || '%'
        or lower(coalesce(products.sku, '')) like '%' || lower(search_query) || '%'
        or exists (
          select 1
          from public.catalog_product_specs as specs
          where
            specs.product_id = products.id
            and lower(concat_ws(' ', specs.name, specs.value, specs.unit))
              like '%' || lower(search_query) || '%'
        )
      )
  )
  select
    scored.id,
    scored.source_site,
    scored.source_external_id,
    scored.source_url,
    scored.name,
    scored.manufacturer,
    scored.model,
    scored.sku,
    scored.summary,
    scored.description,
    scored.technical_details,
    scored.features,
    scored.applications,
    scored.categories,
    scored.image_url,
    scored.image_alt,
    scored.listed_price,
    scored.availability,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'section', specs.section,
          'name', specs.name,
          'value', specs.value,
          'unit', specs.unit
        )
        order by specs.sort_order, specs.name
      )
      from public.catalog_product_specs as specs
      where specs.product_id = scored.id
    ), '[]'::jsonb) as specifications,
    scored.search_rank::double precision as rank
  from scored
  order by scored.search_rank desc, scored.name
  limit least(greatest(result_limit, 1), 12);
$$;

alter table public.catalog_sync_runs enable row level security;
alter table public.catalog_products enable row level security;
alter table public.catalog_product_specs enable row level security;

revoke all on table public.catalog_sync_runs from anon, authenticated;
revoke all on table public.catalog_products from anon, authenticated;
revoke all on table public.catalog_product_specs from anon, authenticated;
revoke all on function public.search_catalog_products(text, integer)
  from public, anon, authenticated;

grant all on table public.catalog_sync_runs to service_role;
grant all on table public.catalog_products to service_role;
grant all on table public.catalog_product_specs to service_role;
grant execute on function public.search_catalog_products(text, integer)
  to service_role;

commit;
