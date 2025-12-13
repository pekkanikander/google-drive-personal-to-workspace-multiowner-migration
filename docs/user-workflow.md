# User Workflow Design

This document explains the migration process from the perspective of
an **ordinary personal Google Drive user**.
The goal is to make the steps as simple, predictable, and low‑friction as possible.
All technical complexity is handled by the Workspace administrator and the migration system.

---

## Who is this for?

This workflow applies to users who:

- Have contributed files or folders in a shared personal Google Drive structure.
- Still have access to their personal Google accounts (Gmail).
- Have been asked by their organisation to migrate their files into a Workspace Shared Drive.

You do **not** need to install software, run scripts, or understand Google Drive internals.

---

## User instructions: What the system will do

Once you authorise the migration app:

- Only **files you personally own** within the **shared personal folder** are processed.
  - Any of your files outside of the shared folder will not be touched.
- Files are moved or copied into the appropriate folder structure in the organisation’s Workspace Shared Drive.
- The web page indicates when you may close the browser; the migration may continue in the background.
- By reopening the link, you will see a status page.

No ownership transfer occurs — Google does not allow that across personal → Workspace migration.
All behaviour is implemented with Drive’s normal move/copy operations.

### What happens to my files?

The admin chooses one of three modes for the migration job and the status page explains which one applies:

1. **Move (default)** — your personal file disappears after transfer and exists only in the Workspace Shared Drive, keeping its original ID.
2. **Copy** — your original personal file stays put (same ID) and only a copy appears into the Workspace Shared Drive (same name, new ID).
3. **Move + Restore Copy** — the original is moved (its ID now lives in the Shared Drive), then the system creates a same-name copy back in the original location so you and your collaborators still see a file there, with the same contents. However, technically it is a new file, which has a new file ID.

The difference between the two move-based modes is whether a replacement copy appears in the personal folder; in both cases the “real” file keeps its ID so existing Drive links continue to work.
If you need to keep a local backup, make one before the admin schedules the migration.

---

## Steps for the User

### 1. Receive the migration link

Your admin will send the user a link that looks something like:

```
https://<organisation-domain>/migrate?job=<identifier>&token=<random>
```

This link is safe to open.
It is specific to the organisation’s migration process, not to you personally.

You can open the link on any device (computer, phone, tablet) where
you have logged in or can log into your personal Google account (GMail).

---

### 2. Review the migration summary

The webpage explains:

- What is being migrated.
- Why you are seeing this page.
- How many files to migrate the system believes you own.
- The name of the organisation’s Workspace Shared Drive where the files will be copied to.
- Which transfer mode the admin selected (move, move+restore, or copy) and what it means for your files.

---

### 3. Sign in with your personal Google account

You will be asked to:

1. Click **“Sign in with Google”**.
2. Choose the **personal Gmail account** that owns your contributed files.
3. Approve the permissions the app requests.

The app needs permission to:

- Read files you owns in the shared personal folder structure.
- Move or create copies of those files into the organisation’s Workspace Shared Drive.

The app **cannot** read the your email, contacts, calendar, etc.
Technically it *can* read your unrelated files, but it does not.
The app is open source, allowing your admin or any other competent person to verify this.

---

### 4. Start the migration

After signing in and granting authorization, you will see:

- A **Start Migration** button.
- A counter showing how many files will be copied.

Clicking **Start Migration** begins the transfers.
The web page is updated to reflect the state of the migration.

---

### 5. Check progress (optional)

You can return later to the same link at any time to see:

- How many files have been migrated.
- How many remain, if any.
- Whether any errors occurred (rare; usually rate limits).

If an error is not automatically resolved, the admin may contact you.

---

## What you should NOT do

- Not to delete files in the shared personal Drive until the admin confirms migration has been completed.
- Not to share your migration link with others.
  - (Does sharing do any harm?  The app will check the user identity anyway?)
- Not attempt to reorganise the destination Workspace folders or files.
- Not try to re-run the migration unless the admin instructs the user.
  - (How could they, if reopening the link shows the status page, not the start page?)

---

## Frequently Asked Questions (draft)

### “Will this give the organisation access to all my Google Drive files?”

Temporarily, while the tool runs, yes.
However, only files you own **within the shared folder tree selected by the admin** are processed.

Once the migration is complete, the organisation no longer has access to your other files.
During the migration, the app does not access your other files, even though techically it could.

### “Will my files disappear from my personal Drive?”

Depends on the mode the admin selected.

In the Move mode, the moved files disappear from your personal drive.
In the Copy mode, copies are created in Workspace; nothing is deleted.
In the Move + Restore Copy mode, the file and its contents will still be in your personal drive, but technically it is a new file.

### “Why must I sign in myself? Can’t the admin do it?”

Google does not permit anyone—including the organisation—to impersonate a personal Gmail user.
You must authorise access once.
This Google restriction is the reason why this tool exists in the first place.

### “What if I no longer need some old files?”

You can safely ignore them.
The migration system will move or copy them according to the selected mode; the admin will manage the Workspace results afterwards.

Once all files have been transferred, you may choose to delete any remaining files (if the job used the copy mode or restored copies).

---

## Completion

When all your files have been copied:

- The status page shows **Completed** and restates which mode was used.
- The admin will see the same status.
- The user may sign out or close the page at any time.

No further action is required from you, unless there are errors.
