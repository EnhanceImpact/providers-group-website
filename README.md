# The Providers Group — Blue editorial redesign

Open `index.html` in VS Code with Live Server. Each page contains editable HTML. The blue palette and responsive styles are in `style.css`; the menu and forms use `script.js`.

## Design
- Blue navigation, cards and accents; cards lift gently on hover.
- Home hero uses the supplied father-and-child photograph with a very light transparent black overlay, text on the right to leave the child visible, and a desktop fixed-background scroll effect. On mobile, the background scrolls normally for browser compatibility and readability.
- The homepage has a single clickable YouTube thumbnail labeled “Anisha’s Journey”; the video itself is embedded once on `give-life.html`. The thumbnail loads from YouTube and requires internet access.
- Each supplied photograph has one placement: father and child on Home, family photo on Home, Anisha’s portrait on Scholarships, and the girl holding a heart on Give Life.

## Before publishing
Connect contact and newsletter forms to a secure form provider and donations to a verified payment processor. Verify contact details, social links and medical content. Video playback and thumbnail require internet access.


## Brand refresh
Navigation pink #E31855, primary blue #458FCE, accent gold #F99F20 sampled from the supplied logo. The real logo is at assets/providers-group-logo.png. External website links open in new tabs with rel="noopener noreferrer". Internal links stay in the same tab. The homepage retains its light transparent-black photo overlay.

## Refined brand update
The header is white to keep the original multicolor logo distinct. Blue remains the primary color, gold is an accent, and pink appears on button hover and active navigation underlines. Keyboard focus uses a gold outline. The homepage's subtle transparent-black photographic overlay remains unchanged.

### Gold accent refinement
Section eyebrow labels, decorative card symbols, and card-link underlines now use the logo's gold (`#F99F20`). All other styling and content are unchanged.

## Supabase-connected version
This package now includes a client-owned Supabase backend, gated Kidney Health Tracker delivery, and a staff admin dashboard. See `README-SUPABASE.md` for deployment steps.
