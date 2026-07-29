begin;

create extension if not exists vector with schema extensions;

create table if not exists public.chat_sessions (
  session_id text primary key,
  conversation_state jsonb not null default '{"version": 0}'::jsonb,
  last_intent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_sessions_session_id_length
    check (char_length(session_id) between 8 and 128)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null
    references public.chat_sessions(session_id) on delete cascade,
  request_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  intent text,
  next_action text,
  products jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, request_id, role)
);

create index if not exists chat_messages_session_created_idx
  on public.chat_messages (session_id, created_at);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  source_url text not null unique,
  title text not null,
  source_type text not null default 'website'
    check (source_type in ('website', 'catalogue', 'manufacturer', 'internal')),
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  last_crawled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null
    references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 12000),
  token_count integer check (token_count is null or token_count >= 0),
  embedding extensions.vector(768),
  embedding_model text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists knowledge_chunks_document_idx
  on public.knowledge_chunks (document_id, chunk_index);

create index if not exists knowledge_chunks_embedding_hnsw_idx
  on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(768),
  match_threshold double precision default 0.58,
  match_count integer default 4
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  source_url text,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    chunks.id as chunk_id,
    documents.id as document_id,
    documents.title,
    documents.source_url,
    chunks.content,
    chunks.metadata,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks as chunks
  join public.knowledge_documents as documents
    on documents.id = chunks.document_id
  where
    chunks.embedding is not null
    and 1 - (chunks.embedding <=> query_embedding) >= match_threshold
  order by chunks.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 12);
$$;

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;

revoke all on table public.chat_sessions from anon, authenticated;
revoke all on table public.chat_messages from anon, authenticated;
revoke all on table public.knowledge_documents from anon, authenticated;
revoke all on table public.knowledge_chunks from anon, authenticated;
revoke all on function public.match_knowledge_chunks(
  extensions.vector,
  double precision,
  integer
) from public, anon, authenticated;

grant all on table public.chat_sessions to service_role;
grant all on table public.chat_messages to service_role;
grant all on table public.knowledge_documents to service_role;
grant all on table public.knowledge_chunks to service_role;
grant execute on function public.match_knowledge_chunks(
  extensions.vector,
  double precision,
  integer
) to service_role;

commit;
