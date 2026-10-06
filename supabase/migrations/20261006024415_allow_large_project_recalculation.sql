-- High-volume imports perform one authoritative project recalculation after all
-- chunks have committed. Give that single backend operation enough time to scan
-- a large Actual Cost ledger while remaining below the Data API ceiling.
alter function public.recalculate_all_project_summaries(uuid)
  set statement_timeout = '50s';
