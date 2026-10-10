# Give Life Journal — 60-week rotation

1. Run `supabase/migrations/002_blog_rotation.sql`.
2. In `config.js`, set `blogRotationStart` to the date Week 1 should begin.
3. Sign into `/admin/` and choose **Blog Articles**.
4. Fill rotation slots 1–60. Keep unfinished articles as Draft.
5. Change an article to Approved only after editorial/medical review.
6. `blog.html` features one approved article based on the current rotation week. Week 61 returns to slot 1 automatically.
7. Previous approved articles remain in the library and retain permanent URLs.

The migration creates 60 draft placeholders so the bank can be filled gradually without exposing unfinished content.
