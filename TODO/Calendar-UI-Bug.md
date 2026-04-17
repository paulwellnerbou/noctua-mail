# Problems with resizable calendar layer

Yesterday we implemented this feature:

> ## Resizeable Calendar Layer
> 
> The Calendar layer that opens when clicking on the date in the statusbar should be resizable. It is already movable

See https://github.com/paulwellnerbou/noctua-mail/pull/34

Problems:

- I don't want only a handle in the lower right corner. I want to be able to resize it from all sides, just like any other window. This is the standard behavior of windows in Windows OS, and I want to follow this standard.
- Resizing it sometimes "locks in" the mousedown and the mouseup is not registered any more, so I cannot "drop" the resized layer. Even text is selected in the background. I have to refresh the page to fix this.
