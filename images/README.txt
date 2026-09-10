This folder holds the images referenced by about.html. None are included
yet — about.html will just show alt text for any <img> whose file is
missing, so nothing is broken until you add these.

Drop in:
  portrait.jpg                                     — square-ish, ~500x500, for the circular crop
  80485-space-ants.jpg                              — book cover, ~2:3 ratio
  DAHB Indie Mil Hard SciFi 2.png                   — book cover, ~2:3 ratio
  Above-Dark-Waters-AI-Therapy-Cyberpunk-HardSF.png — book cover, ~2:3 ratio
  ahom.jpg                                          — book cover, ~2:3 ratio

Filenames must match exactly what's in about.html's src= attributes
(case-sensitive). To add/remove/rename a book, edit the matching
<article class="book"> block in about.html directly.
