# Vehicle Maintenance App

Log fill-ups, track MPG, and keep up with maintenance. It's an installable web app (PWA) that works offline on iPhone, Android, Windows and Mac. There's no server and no account: each person's data is saved in their own browser, on their own device.

## What's in the folder

| File | What it is |
|---|---|
| `index.html` | The page: all three screens (Log, Vehicles, Settings) and the dialogs |
| `app.css` | Styles. Colors are at the top, with dark mode values right below |
| `app.js` | The screens: forms, lists, the add-a-vehicle walkthrough, export and import buttons |
| `data.js` | Storage (IndexedDB), MPG and maintenance math, the standard schedule, CSV export and import |
| `sw.js` | Service worker: makes the app open offline |
| `manifest.webmanifest` | App name, icon and colors used when it's installed |
| `icons/` | App icons |

No build step and nothing to install. Edit a file, upload it, done.

## Put it on GitHub Pages

You only need a web browser. About 10 minutes the first time.

1. Go to [github.com](https://github.com) and sign in, or create a free account.
2. Click **+** at the top right, then **New repository**.
3. Name it something short, like `vehicle-maintenance-app`. This becomes part of the web address. Choose **Public** (free GitHub Pages needs a public repository; the code is public, but nobody's data is, because data never leaves their device). Click **Create repository**.
4. On the new, empty repository page, click the **uploading an existing file** link.
5. Unzip `vehicle-maintenance-app.zip` on your computer. Open the folder and drag **everything inside it** (the files and the `icons` folder) into the upload box. Don't drag the outer folder itself, or the app ends up one level too deep.
6. Check that the list shows `index.html`, `app.css`, `app.js`, `data.js`, `sw.js`, `manifest.webmanifest`, `README.md`, `install-steps.md` and the files in `icons/`. Click **Commit changes**.
7. Click **Settings** (top of the repository), then **Pages** in the left sidebar.
8. Under **Build and deployment**, set **Source** to **Deploy from a branch**, then set **Branch** to **main** and the folder to **/ (root)**. Click **Save**.
9. Wait a minute or two and refresh the Pages settings page. It will say **Your site is live at** `https://YOUR-USERNAME.github.io/vehicle-maintenance-app/`. Open that link to check it.
10. Share that link, along with the steps in `install-steps.md`.

**Keep the address the same once people use it.** Each person's data is tied to the web address. If you rename the repository or move the app, their data stays behind at the old address; they'd have to export from the old one and import into the new one.

### Updating the app later

Open the file on GitHub, click the pencil icon, make your change and click **Commit changes**. Or use **Add file → Upload files** to replace files. The site updates within a minute or two, and installed copies pick up the change the next time they're opened with a connection (if it doesn't show right away, close the app fully and open it again).

You don't need to bump a version number in `sw.js` when you edit. Only change `CACHE` there if you rename, add or remove files, and update the `FILES` list to match.

### Cloudflare Pages instead

In the Cloudflare dashboard, create a Pages project using direct upload and drop in the unzipped folder's contents. You get an address like `https://vehicle-maintenance-app.pages.dev`. Everything else is the same.

## Trying changes on your own computer

Opening `index.html` by double-clicking won't run the offline parts. Instead, in a terminal inside the folder, run `python3 -m http.server 8000` and open `http://localhost:8000`. Data you enter there is separate from the live site.

## Handy places to edit

- **Standard maintenance schedule** (what new vehicles start with): `STANDARD_SCHEDULE` near the top of `data.js`. `every` is miles between services and `remind` is how many miles before it's due the reminder starts. Changes only affect vehicles added afterward; existing ones keep their own copy.
- **MPG warning**: `WARN_PCT` in `data.js` (0.20 = warn when a fill-up is 20% above or below the vehicle's average).
- **Missed fill-up detection**: `GAP_RATIO` in `data.js`. A stretch whose MPG is 1.6 times the vehicle's usual MPG is treated as fill-ups that weren't logged and left out.
- **Backup reminder**: `backupDue()` in `app.js` (currently after 30 days with new records, or once there are 5 records and no backup yet).
- **Colors and fonts**: the top of `app.css`.

## Colors, Light/Dark and palettes

The Settings screen has an **Options** section: Light / Dark / System, and a Color picker (Blue, Green, Red, Orange, Purple, Teal, Monochrome). The choices are saved on the device (`vma:theme`, `vma:palette`) and applied as `data-theme` and `data-palette` on `<html>`. Blue is the default at the top of `app.css`; the other palettes are in the "Color palettes" section below it. To add one, copy a palette block in `app.css` and add its name to `PALETTES` in `app.js`.

## The backup file (CSV)

One file holds everything needed to rebuild the app on another device. It opens in Excel. The `record_type` column says what each row is, and columns that don't apply to a row are blank.

| record_type | What the row is | Columns used |
|---|---|---|
| `vehicle` | A vehicle | `vehicle` (name), `odometer` and `date` (starting odometer, optional), `active` (yes/no), `vehicle_id`, `created_at` |
| `schedule` | One maintenance item for a vehicle | `vehicle`, `item`, `every_mi`, `remind_mi`, `vehicle_id`, `item_id` |
| `shop` | A shop from the list | `shop` |
| `fillup` | A fill-up | `vehicle`, `date`, `odometer`, `gallons`, `price_per_gallon`, `total` (receipt total, optional), `station`, `missed` (yes or blank), `vehicle_id`, `id`, `created_at` |
| `maintenance` | One logged service | `vehicle`, `date`, `odometer`, `shop`, `item`, `notes`, `vehicle_id`, `item_id`, `visit`, `id`, `created_at` |

Dates are written as YYYY-MM-DD. Import also accepts what Excel writes when it re-saves the file (M/D/YYYY, D/M/YYYY or D.M.YYYY, semicolon-separated files, decimal commas). Text that starts with `=`, `+`, `-` or `@` gets a leading `'` in the file so Excel doesn't run it as a formula; import removes it again.

Importing shows a preview first: how many vehicles, fill-ups and maintenance records are in the file, how many duplicates will be skipped, and any rows that can't be used, with line numbers. Then you choose:

- **Merge** keeps everything on the device and adds what's new. A fill-up is a duplicate when the vehicle, date and odometer match. Vehicles are matched by id, then by name.
- **Replace everything** deletes what's on the device and loads the file. It asks twice.

Exporting from one device and importing on an empty one gives identical data.
