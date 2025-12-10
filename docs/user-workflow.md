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

- Only **files you personally own** within the **shared drive** will be copied.
  - Any of your files outside of the shared folder will not be touched.
- Files will be copied into the appropriate folder structure in the organisation’s Workspace.
- Once the copying has been initiated, you may close the browser;
  the migration continues in the background.
- By reopening the link, you will see a status page showing how many files are done.

No files are deleted from your personal Drive.
No ownership transfer occurs — Google does not allow that across personal → Workspace migration.

---

## Steps for the User

### 1. Receive the migration link

Your admin will send the user a link that looks something like:

```
https://<organisation-domain>/migrate?job=<identifier>&token=<random>
```

This link is safe to open.
It is specific to the organisation’s migration process, not to the user personally.

The user can open the link on any device (computer, phone, tablet) where
they have logged in or can log into their personal Google account (GMail).

---

### 2. Review the migration summary

The webpage explains:

- What is being migrated.
- Why the user is seeing this page.
- How many files to migrate the system believes the user owns.
- The name of the organisation’s Workspace Shared Drive where the files will be copied.

If the numbers look wrong, the web page advices the user to contact the admin before proceeding.

---

### 3. Sign in with your personal Google account

The user will be asked to:

1. Click **“Sign in with Google”**. (Is this correct?  What is the OAuth dialog like?)
2. Choose the **personal Gmail account** that owns your contributed files.
3. Approve the permissions the app requests.

The app needs permission to:

- Read files the user owns in the shared personal folder structure.
- Create copies of those files into the organisation’s Workspace Shared Drive.

The app **cannot** read the user's email, contacts, calendar, or unrelated files.

---

### 4. Start the migration

After signing in and granting authorization, the user will see:

- A **Start Migration** button.
- A counter showing how many files will be copied.

Clicking **Start Migration**.

After that, the user may close the browser.
The migration continues automatically.

---

### 5. Check progress (optional)

The user can return to the same link at any time to see:

- How many files have been migrated.
- How many remain.
- Whether any errors occurred (rare; usually rate limits).

If an error is not automatically resolved, the admin may contact the user.

---

## What the user should NOT do

- Not to delete files in the shared personal Drive until the admin confirms migration has been completed.
- Not to share your migration link with others.
  - Does sharing do any harm?  The app will check the user identity anyway?
- Not attempt to reorganise the destination Workspace folders or files.
- Not try to re-run the migration unless the admin instructs the user.
  - How could they, if reopening the link shows the status page, not the start page?

---

## Frequently Asked Questions (draft)

### “Will this give the organisation access to all my Google Drive files?”

No.
Only files you own **within the shared folder tree selected by the admin** are processed.

The app does not access your other files.

### “Will my files disappear from my personal Drive?”

No.
Copies are created in Workspace; nothing is deleted.

### “Why must I sign in myself? Can’t the admin do it?”

Google does not permit anyone—including the organisation—to impersonate a personal Gmail user.
You must authorise access once.

### “What if I no longer need some old files?”

You can safely ignore them.
The migration system will copy them; the admin will manage the copies afterwards.

Once all files has been copied, you may delete any of your old files, if you want to.

---

## Completion

When all the user's files have been copied:

- The status page shows **Completed**.
- The admin will see the same status.
- The user may sign out or close the page at any time.

No further action is required from the user, unless there are errors.
