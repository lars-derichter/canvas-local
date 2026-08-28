# Canvas Setup

Connecting Coursewright to Canvas takes three credentials: the API URL, an
access token, and the course ID. They are only needed for the Canvas sync; a
course that publishes to the website or as PDF and Word handouts never needs
this page.

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
> `.env` file where this token is stored is already listed in `.gitignore`, so
> git leaves it on your computer. New to those terms?
> [Git and GitHub basics](git-and-github.md) explains them.

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
- Copy the example file and fill in the values by hand:

  ```bash
  cp .env.example .env
  ```

  ```
  CANVAS_API_URL=https://school.instructure.com
  CANVAS_API_TOKEN=your-token-here
  CANVAS_COURSE_ID=12345
  ```

Then pick up where you left off: the
[Canvas route in your first course](first-course.md#canvas) walks the first
push, and [Canvas sync](user-guide.md#canvas-sync) in the user guide is the full
command reference. Before that first push to a course that already holds
content, take a [backup](backups.md).
