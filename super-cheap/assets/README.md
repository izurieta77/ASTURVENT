# SUPER CHEAP - Assets for Dashboard

Generated supporting images and a short demo video for the operational dashboard.

## Images

- `images/1.jpg`: Clean illustration of an aggregated monthly chart for long periods.
- `images/2.jpg`: Empty state illustration for charts with no data.
- `images/3.jpg`: Before/after comparison of cluttered daily data vs clean aggregated view for one year.

These are available for empty states, help modals, internal docs, or training material. They are not loaded by default in the operational dashboard.

## Videos

- `videos/1.mp4`: Short 8s muted demo showing long-period daily data transitioning into a smart aggregated view. Optimized for web delivery.

## Chart Improvements

The main trend charts, both the vanilla Chart.js dashboard and the React/Recharts prototype, now aggregate long date ranges automatically:

- More than 50 days or 60+ points: weekly buckets.
- More than 200 days or 180+ points: monthly buckets.
- More than 730 days or 360+ points: quarterly buckets.
- More than 1500 days or 900+ points: yearly buckets.
- Hard cap: 84 trend points and 48 sparkline points.

This prevents unreadable "infinite" charts while preserving totals and trend direction.

Legacy charts use the same aggregation instead of lossy thinning. No backend changes are needed; bucketing stays client-side.
