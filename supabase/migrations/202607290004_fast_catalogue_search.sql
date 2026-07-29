begin;

drop trigger if exists catalog_products_search_refresh
  on public.catalog_products;
create trigger catalog_products_search_refresh
before insert or update of
  name,
  manufacturer,
  model,
  sku,
  summary,
  description,
  categories
on public.catalog_products
for each row
execute function public.refresh_catalog_product_search();

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
    new.description,
    array_to_string(new.categories, ' ')
  );
  new.search_vector := to_tsvector('simple', new.search_text);
  return new;
end;
$$;

drop index if exists public.catalog_products_search_text_trgm_idx;

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
      trim(search_query) as original,
      lower(trim(search_query)) as normalized,
      websearch_to_tsquery('simple', trim(search_query)) as text_query
  ),
  candidates as (
    select
      products.*,
      (
        ts_rank_cd(products.search_vector, query_parts.text_query) * 20
        + similarity(products.name, query_parts.original) * 8
        + similarity(
            coalesce(products.model, ''),
            query_parts.original
          ) * 10
        + similarity(
            coalesce(products.sku, ''),
            query_parts.original
          ) * 12
        + case
            when lower(products.name) = query_parts.normalized then 20
            when products.name ilike
              '%' || query_parts.original || '%' then 8
            else 0
          end
        + case
            when products.source_external_id like 'verified:%' then 1
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
        or products.name % query_parts.original
        or coalesce(products.model, '') % query_parts.original
        or coalesce(products.sku, '') % query_parts.original
      )
    order by search_rank desc, products.name
    limit greatest(least(result_limit, 12) * 30, 60)
  ),
  deduplicated as (
    select
      candidates.*,
      row_number() over (
        partition by lower(candidates.name)
        order by
          candidates.search_rank desc,
          candidates.updated_at desc
      ) as duplicate_rank
    from candidates
  )
  select
    deduplicated.id,
    deduplicated.source_site,
    deduplicated.source_external_id,
    deduplicated.source_url,
    deduplicated.name,
    deduplicated.manufacturer,
    deduplicated.model,
    deduplicated.sku,
    deduplicated.summary,
    deduplicated.description,
    deduplicated.technical_details,
    deduplicated.features,
    deduplicated.applications,
    deduplicated.categories,
    deduplicated.image_url,
    deduplicated.image_alt,
    deduplicated.listed_price,
    deduplicated.availability,
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
      where specs.product_id = deduplicated.id
    ), '[]'::jsonb) as specifications,
    deduplicated.search_rank as rank
  from deduplicated
  where deduplicated.duplicate_rank = 1
  order by deduplicated.search_rank desc, deduplicated.name
  limit least(greatest(result_limit, 1), 12);
$$;

revoke all on function public.refresh_catalog_product_search()
  from public, anon, authenticated;
revoke all on function public.search_catalog_products(text, integer)
  from public, anon, authenticated;
grant execute on function public.search_catalog_products(text, integer)
  to service_role;

commit;
