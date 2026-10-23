# Canva Bulk PPTX Downloader (Chrome extension)

You pick Canva templates quickly while you browse. The extension then downloads them one by one as PPTX (PowerPoint), at a slow and steady pace, and packs them into ZIP files. It can run 24/7.

Please read the "Read this first" part of the architecture document. Automatic clicking on Canva is against Canva's Terms of Use, so use this only for your own work, slowly, on your own account. Never share or sell the downloaded templates.

## Install

1. Unzip this folder somewhere safe, for example `Documents/canva-bulk-download`.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `canva-bulk-download` folder.
5. Pin the extension to the toolbar (puzzle icon, then the pin).

## Before the first real run: check Canva's buttons

Canva changes its website often. The extension finds buttons by their words, and these words live in `content/selectors.js`.

1. Do one download by hand on Canva: open a template, click **Use this template**, then **Share**, **Download**, choose **PPTX** in the file type menu, and click **Download**.
2. Check that the words on the buttons match the lists in `content/selectors.js` (`useTemplate`, `share`, `download`, `pptxOption`, `finalDownload`). If your Canva is not in English, add your words to the lists.
3. Open `chrome://downloads` and look at where the file came from. If it is not a `canva.com` address, add that address to `host_permissions` in `manifest.json`. Without it, files are saved outside the ZIP, in the `not-in-zip` folder.
4. After changing a file, click the reload icon on the extension in `chrome://extensions`.
5. Test with 5 to 10 templates before you start a big queue.

## How to use

1. Log in to Canva in Chrome.
2. Build the queue:
   - On template list and search pages, each template card has a checkbox. Tick the ones you want, or click **Tick all on this page**, then click **Add ticked**.
   - On a single template page, click **Add this template**.
   - Or paste links into the popup (**Paste template links**), one per line.
   - Or import a `.txt` or `.csv` file of links on the Settings page.
3. Click the extension icon and press **Start**. You can close the popup.
4. ZIP files are saved in `Downloads/Canva Templates/`, for example `Canva Templates 2026-10-22 part-1.zip`. A new ZIP is made every 50 templates and when the queue is finished. **Make ZIP now** packs the files collected so far.

## Running 24/7

- Leave the PC on. While the queue runs, the extension keeps the PC from sleeping.
- In Chrome settings, turn on **On startup: Continue where you left off**, and let Chrome start when Windows starts. After a restart the queue continues by itself.
- When the daily limit is reached, the extension sleeps until the next day.
- Chrome notifications tell you when it stops and needs you: logged out, a "verify you are human" check, a full disk, or a closed tab. Fix the problem and press **Start** again.

## Settings

Open the popup and click **Settings**.

| Setting | Default |
| --- | --- |
| Folder in Downloads | Canva Templates |
| Wait between templates | random 20 to 45 seconds |
| Templates per hour | 40 |
| Templates per day | 100 (start with 50 to 100 in the first week) |
| Templates in one ZIP | 50 |
| Tries per template | 3 |
| Give up on a stuck template after | 120 seconds |

Canva does not publish a limit for its website. These numbers are safe guesses.

## When something fails

| Message | What to do |
| --- | --- |
| Could not find "...". Canva page may have changed | Canva changed a button. Fix the words in `content/selectors.js`, reload the extension, then **Retry failed**. |
| Needs Canva Pro | This template is Pro only. It is skipped. |
| Logged out of Canva | Log in again and press **Start**. |
| Canva asks you to verify you are human | Stop for some hours. Solve the check yourself, lower the daily limit, then press **Start**. |
| Saved outside the ZIP | The extension could not read the file itself. See step 3 of "Before the first real run". |

## Files

| File | What it does |
| --- | --- |
| `manifest.json` | Permissions and files |
| `config.js` | Default numbers |
| `background/index.js` | Starts everything, listens to Chrome events and messages |
| `background/pacer.js` | One template at a time, waits, limits, restart and stuck checks |
| `background/tabs.js` | Opens and closes the template tab, starts the runner |
| `background/downloads.js` | Catches the file, stores it, builds and saves ZIP files |
| `background/store.js` | Saves the queue, state and counters |
| `background/notify.js` | Notifications and keep-awake |
| `content/selectors.js` | The words used to find Canva's buttons (edit this) |
| `content/picker.js` | Checkboxes and the panel on Canva template pages |
| `content/runner.js` | Clicks the buttons in the tab the extension opened |
| `offscreen/zip.js` | Hidden page that builds the ZIP |
| `lib/zip.js`, `lib/fileStore.js` | ZIP writer and file storage (IndexedDB) |
| `popup/`, `options/` | The popup and the Settings page |

A difference from the architecture document: the ZIP is built by a small ZIP writer in `lib/zip.js` instead of the JSZip library. It needs no download and stores PPTX files without compressing them again, which is faster.
