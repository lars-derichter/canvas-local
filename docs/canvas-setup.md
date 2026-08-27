# Canvas Setup

This guide walks you through obtaining the three credentials needed to connect
Coursewright to your Canvas LMS instance.

## Canvas API URL

The API URL is your institution's Canvas web address. You can find it by logging
into Canvas and looking at the URL in your browser's address bar. It will look
something like:

```
https://school.instructure.com
```

Copy the base URL **without** any path after the domain (no `/courses/...` or
`/api/v1`). The CLI automatically appends `/api/v1` when making API calls.

> [!TIP]
>
> If your institution uses a custom domain (e.g.
> `https://canvas.university.edu`), use that instead.

## Canvas API Token

An API access token lets Coursewright interact with Canvas on your behalf. To
create one:

1. Log in to Canvas and click on **Account** (your profile icon in the left
   sidebar).
2. Select **Settings**.
3. Scroll down to the **Approved Integrations** section.
4. Click **+ New Access Token**.
5. Fill in a **Purpose** (e.g. "Coursewright") so you can recognise it later.
6. Optionally set an **Expiry date**. If left blank the token will not expire.
7. Click **Generate Token**.
8. **Copy the token immediately.** It will only be shown once. If you lose it,
   you will need to generate a new one.

> [!WARNING]
>
> Treat your API token like a password. Do not commit it to version control. The
> `.env` file where this token is stored is already listed in `.gitignore`.

For more information, see the Canvas documentation:
[How do I manage API access tokens in my user account?](https://community.instructure.com/t5/Canvas-Basics-Guide/How-do-I-manage-API-access-tokens-in-my-user-account/ta-p/615312)

## Canvas Course ID

The course ID is the numeric identifier Canvas uses for your course. To find it:

1. Log in to Canvas and navigate to the course you want to sync with.
2. Look at the URL in your browser's address bar. It will look like:
   ```
   https://school.instructure.com/courses/12345
   ```
3. The number after `/courses/` is your course ID (in this example: `12345`).

You can also find the course ID on the course **Settings** page or via the
**Dashboard** by hovering over a course card and checking the link URL.

For more information, see the Canvas documentation:
[How do I find my course ID?](https://community.canvaslms.com/t5/Canvas-Basics-Guide/How-do-I-find-my-Canvas-course-ID/ta-p/55)

## Next Steps

Once you have all three values, either:

- Run `npx course init` for an interactive setup (`npx course setup` offers this
  as its last question, so you may have done it already), or
- Copy `.env.example` to `.env` and fill in the values manually:
  ```
  CANVAS_API_URL=https://school.instructure.com
  CANVAS_API_TOKEN=your-token-here
  CANVAS_COURSE_ID=12345
  ```
