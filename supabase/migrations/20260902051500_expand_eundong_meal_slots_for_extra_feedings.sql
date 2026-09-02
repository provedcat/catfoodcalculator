alter table public.eundong_meals
  drop constraint if exists eundong_meals_meal_slot_check;

alter table public.eundong_meals
  add constraint eundong_meals_meal_slot_check
  check (meal_slot >= 1 and meal_slot <= 20);
