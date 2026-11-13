-- Legacy explanation decisions may have no stored reason. Preserve those NULL values.
alter table public.absence_explanation_decisions
  alter column reason drop not null;
