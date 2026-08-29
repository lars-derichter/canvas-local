# Attaching a Study Pack

What a student does to hand the chatbot the course, and what the teacher
confirms before the packs ship. The intro page of the `NN-study-packs/`
subsection carries the first three sections, in the course language; Phase A
quotes the last one to the teacher.

## The Upload Step

Tool-agnostic wording, for the intro page only. A prompt page's "How to use it"
list keeps one line, "attach the study pack of the module you are studying", and
links the intro page for these steps and the per-tool lines below.

1. Start a new chat.
2. Use the attach control next to the message box, usually a paperclip or a plus
   button.
3. Pick the pack file, `<pack>.md`, from where you downloaded it.
4. Paste the whole prompt from the prompt page into the message box.
5. Send. The chatbot opens with a question; answer it and go on from there.

## Per Tool

Checked: 2026-08. Check yearly, these controls move.

- **ChatGPT:** the plus button in the message box (older layouts show a
  paperclip), then the entry that adds photos and files. Uploads work on the
  free plan, with a daily cap.
- **Claude:** the plus button in the lower left of the chat box, then "Add files
  or photos". Dropping the file onto the chat window also works.
- **Gemini:** the plus button ("Add files") in the text box, then "Upload
  files".
- **Microsoft Copilot:** the plus button in the chat box, then "Add images or
  files". Copilot lists MD among the text formats it accepts.
- **NotebookLM:** source-based rather than chat-first. Create a notebook, choose
  "Add sources", upload the pack (Markdown is a listed format), then paste the
  prompt into the notebook's chat as the first message. NotebookLM answers from
  its sources by design, which is the attachment rule built in.

## File Format

The pack is a `.md` file: plain text with markdown headings. Every tool above
accepts it as text. If one refuses the extension, rename a copy to `.txt`; the
content is the same.

## Privacy and Copyright

The teacher confirms this in Phase A before any pack is generated. Quote it:

> Uploading course material sends it to a third-party service. Free consumer
> tiers may use uploads to train models unless the student opts out, and the
> opt-out sits in each tool's own settings. The material is yours, or the
> institution's, and you decide whether students may upload it. Institution
> accounts or education tiers are the safer route where they exist. The
> student-facing intro page should say what you decided: which tools are
> allowed, whether a personal account is acceptable, and whether to opt out of
> training.

Do you confirm that students may upload these packs, and under which conditions?
