# 60-article Give Life Journal content bank

Contains **60 distinct editorial drafts**, with the agreed distribution: 15 kidney health, 15 organ donation/transplant awareness, 10 wellness, 10 family conversations, 10 community advocacy.

## Install
1. Run `001_providers_group.sql`, then `002_blog_rotation.sql` as described in BLOG-SETUP.md.
2. Run `supabase/migrations/003_60_article_bank.sql` in Supabase SQL Editor. It fills the existing 60 **draft** slots. The update intentionally skips slots already approved, to avoid overwriting edited/published material.
3. Review each article for editorial quality, clinical accuracy, current facts, working source links, organizational voice, and local/state donor-registration details.
4. In `/admin/`, approve articles after review. The site automatically rotates the featured position every week. Draft articles are not publicly readable.
5. Set the rotation start date in `config.js`. Approve all 60 before launching a fully uninterrupted cycle; otherwise the existing UI falls back to another approved article if a slot is still draft.

## Content formats
- `content/60-articles.json`: editable, complete article objects.
- `content/60-articles.csv`: spreadsheet-friendly copy.
- `supabase/migrations/003_60_article_bank.sql`: one-time data import.

## Editorial cautions
- Articles are concise educational blog drafts, not clinician-reviewed publications. Do not auto-approve them without human review.
- Avoid representing the site as providing diagnosis, medical screening, or personalized advice.
- Verify up-to-date organ donation and transplant policies with official resources before publication.
- No fabricated patient stories, quotes, or claimed organizational outcomes are included.
- Article source URLs appear as plain text in the current site's safe text renderer. If desired, a future enhancement can convert validated sources into clickable links without permitting arbitrary HTML.
- All 60 entries have `status = draft` by design.
