begin;

create index if not exists catalog_products_name_compact_trgm_idx
  on public.catalog_products
  using gin (
    regexp_replace(
      lower(name),
      '[^a-z0-9]+',
      '',
      'g'
    ) extensions.gin_trgm_ops
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
      trim(search_query) as original,
      lower(trim(search_query)) as normalized,
      regexp_replace(
        lower(trim(search_query)),
        '[^a-z0-9]+',
        '',
        'g'
      ) as compact,
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
            when regexp_replace(
              lower(products.name),
              '[^a-z0-9]+',
              '',
              'g'
            ) = query_parts.compact then 16
            when regexp_replace(
              lower(products.name),
              '[^a-z0-9]+',
              '',
              'g'
            ) like '%' || query_parts.compact || '%' then 8
            else 0
          end
        + case
            when products.source_external_id like 'verified:%' then 100
            else 0
          end
      )::double precision as search_rank
    from public.catalog_products as products
    cross join query_parts
    where
      products.status = 'published'
      and query_parts.compact <> ''
      and (
        products.search_vector @@ query_parts.text_query
        or products.name % query_parts.original
        or (
          products.model is not null
          and products.model % query_parts.original
        )
        or (
          products.sku is not null
          and products.sku % query_parts.original
        )
        or regexp_replace(
          lower(products.name),
          '[^a-z0-9]+',
          '',
          'g'
        ) like '%' || query_parts.compact || '%'
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

revoke all on function public.search_catalog_products(text, integer)
  from public, anon, authenticated;
grant execute on function public.search_catalog_products(text, integer)
  to service_role;

commit;
