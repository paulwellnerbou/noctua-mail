# Mail Composition Requirements

## General rules

- Reply/Reply All/Forward should always behave the same (just the header are different).
- New Mail should behave the same, too, with the exception that we don't have any original message to quote

## My special concept for replying and forwarding quoted HTML mails

I want to avoid that the HTML quote depends on the HTML editor we use. So by default, when replying/forwarding to an HTML message, the quoted original message is in a different section (read-only HTML view) and not part of the HTML editor.

To protect this original HTML even more, there is a button "Quote HTML" that controls the "quote line"/quote markers (left line).

If the user wants to edit the original HTML, they click on "Edit Quoted HTML". This moves the original HTML into the editor and makes it editable.

When I say "HTML Mails" it applies to all mails sent in HTML format (composed in either HTML or Markdown mode, but not text mode).

## Behaviour

### Replying or forwarding message

Already implemented:

- If the message is just text message, the text editor opens with the original message quoted in text format.
- If the message is an HTML message, the HTML editor opens with the original message quoted in the extra read-only HTML section below.

### Draft handling

- Drafts are saved automatically. This already works.
- TODO: "Discarding a Draft" should delete the message completely, not just moving it to Trash
- TODO: Opening a Draft should restore exactly the state of the compose form when it was last saved. This applies for the HTML quote section, too. This means for the implementation:
   - We need to store if the user clicked on "Edit Quoted HTML" or not to decide if the quoted HTML should be in the editor or in the read-only section when we restore a draft (maybe as data attribute in the blockquote element?)
   - We need to be able to restore the exact original HTML quote content from the message (blockquote element with custom data id?)

### Switching between message formats

Rule: Switching between HTML/Markdown/Text should not lose content, but convert it to the new format. The user should be able to switch back and forth without losing content. The actual conversion (with potentially loosing formatting) happens after the user starts to edit the message after switching.

This is currently already implemented, I want to make sure that it keeps working:

- A user starts to write a message in HTML mode. The draft is autosaved in HTML format.
- Switching to Markdown or Text allows the user to see a converted preview of the current message (but without loosing the original content yet!). The user should be able to return to HTML mode and continue editing.
- If the user switches to Markdown or Text and then continues editing, the message should be converted to the new format and saved in that format from then on. Switching back to HTML will show a preview of the converted markdown/text content, not the original content any more.

Same behaviour for the other options, of course.

Would be cool to verify that this behaviour is preserved in the tests.

## UI Rules

- Radix components wherever possible
- Keep consistency (e.g. tabs should have the same style as message view tabs, and so on)
- Avoid producing duplicated code
- Separate components for good code structure
