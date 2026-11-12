# GIF fixtures

Made with PIL 12: photo (120x90, 256 colours, so the LZW table fills and codes reach 12 bits), odd (37x23, 4 colours), dot (1x1), transparent (a clear hole), interlaced. local.gif is odd.gif with its colour table moved into its frame (a local table). anim.gif (ImageMagick): a 20x15 first frame at +10+8 on a 50x40 screen, then a full frame.

References (`<name>.ref.png`, RGBA) are PIL's first frame, but anim.gif's is ImageMagick's `anim.gif[0] -background none -layers flatten`: browsers draw a first frame on a clear screen, where PIL fills it with the background colour.
