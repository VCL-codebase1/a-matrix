begin;

alter table public.catalog_products
  add column if not exists search_text text not null default '',
  add column if not exists search_vector tsvector;

create or replace function public.refresh_catalog_product_search()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search_text := concat_ws(
    ' ',
    new.name,
    new.manufacturer,
    new.model,
    new.sku,
    new.summary,
    array_to_string(new.categories, ' ')
  );
  new.search_vector := to_tsvector('simple', new.search_text);
  return new;
end;
$$;

drop trigger if exists catalog_products_search_refresh
  on public.catalog_products;
create trigger catalog_products_search_refresh
before insert or update of
  name,
  manufacturer,
  model,
  sku,
  summary,
  categories
on public.catalog_products
for each row
execute function public.refresh_catalog_product_search();

update public.catalog_products
set
  search_text = concat_ws(
    ' ',
    name,
    manufacturer,
    model,
    sku,
    summary,
    array_to_string(categories, ' ')
  ),
  search_vector = to_tsvector(
    'simple',
    concat_ws(
      ' ',
      name,
      manufacturer,
      model,
      sku,
      summary,
      array_to_string(categories, ' ')
    )
  )
where search_vector is null or search_text = '';

create index if not exists catalog_products_search_vector_idx
  on public.catalog_products using gin (search_vector);
create index if not exists catalog_products_search_text_trgm_idx
  on public.catalog_products
  using gin (lower(search_text) extensions.gin_trgm_ops);
create index if not exists catalog_product_specs_search_trgm_idx
  on public.catalog_product_specs
  using gin (
    lower(name || ' ' || value) extensions.gin_trgm_ops
  );

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
  with query_parts as (
    select
      lower(trim(search_query)) as normalized,
      websearch_to_tsquery('simple', trim(search_query)) as text_query
  ),
  candidates as (
    select
      products.*,
      (
        ts_rank_cd(products.search_vector, query_parts.text_query) * 20
        + similarity(
            lower(products.search_text),
            query_parts.normalized
          ) * 4
        + similarity(
            lower(products.name),
            query_parts.normalized
          ) * 8
        + similarity(
            lower(coalesce(products.model, '')),
            query_parts.normalized
          ) * 10
        + similarity(
            lower(coalesce(products.sku, '')),
            query_parts.normalized
          ) * 12
        + case
            when lower(products.name) = query_parts.normalized then 20
            when lower(products.name)
              like '%' || query_parts.normalized || '%' then 8
            else 0
          end
      )::double precision as search_rank
    from public.catalog_products as products
    cross join query_parts
    where
      products.status = 'published'
      and trim(search_query) <> ''
      and (
        products.search_vector @@ query_parts.text_query
        or lower(products.search_text) % query_parts.normalized
        or lower(products.name)
          like '%' || query_parts.normalized || '%'
        or lower(coalesce(products.model, ''))
          like '%' || query_parts.normalized || '%'
        or lower(coalesce(products.sku, ''))
          like '%' || query_parts.normalized || '%'
        or exists (
          select 1
          from public.catalog_product_specs as specs
          where
            specs.product_id = products.id
            and (
              lower(specs.name || ' ' || specs.value)
                % query_parts.normalized
              or lower(specs.value)
                like '%' || query_parts.normalized || '%'
            )
        )
      )
    order by search_rank desc, products.name
    limit greatest(least(result_limit, 12) * 20, 40)
  )
  select
    candidates.id,
    candidates.source_site,
    candidates.source_external_id,
    candidates.source_url,
    candidates.name,
    candidates.manufacturer,
    candidates.model,
    candidates.sku,
    candidates.summary,
    candidates.description,
    candidates.technical_details,
    candidates.features,
    candidates.applications,
    candidates.categories,
    candidates.image_url,
    candidates.image_alt,
    candidates.listed_price,
    candidates.availability,
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
      where specs.product_id = candidates.id
    ), '[]'::jsonb) as specifications,
    candidates.search_rank as rank
  from candidates
  order by candidates.search_rank desc, candidates.name
  limit least(greatest(result_limit, 1), 12);
$$;

revoke all on function public.refresh_catalog_product_search()
  from public, anon, authenticated;
revoke all on function public.search_catalog_products(text, integer)
  from public, anon, authenticated;
grant execute on function public.search_catalog_products(text, integer)
  to service_role;

commit;
