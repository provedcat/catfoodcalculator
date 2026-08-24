alter table public.eundong_daily_feeds
  drop constraint if exists eundong_daily_feeds_feed_slot_check;

alter table public.eundong_daily_feeds
  add constraint eundong_daily_feeds_feed_slot_check
  check (feed_slot >= 1 and feed_slot <= 6);

alter table public.eundong_meals
  drop constraint if exists eundong_meals_feed_slot_check;

alter table public.eundong_meals
  add constraint eundong_meals_feed_slot_check
  check (feed_slot >= 1 and feed_slot <= 6);
