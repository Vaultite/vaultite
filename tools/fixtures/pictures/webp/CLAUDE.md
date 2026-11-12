# WebP fixtures

Each is held exactly to a reference (`<name>.ref.png`): `dwebp -png`'s pixels (libwebp 1.6), and for an animation PIL 12's first frame (`Image.open(f).seek(0)`, then RGBA), which is libwebp's WebPAnimDecoder: the frame at its offset on a transparent canvas, unblended.

Sources, all drawn for them. With PIL 12: photo (96x64), photo-m (160x128), odd (37x23) and odd-tall (17x33), sine colour fields with soft discs, a line, grain and "WebP 42" in PIL's default font; srgb.icc is `ImageCms.createProfile("sRGB")`. With ImageMagick: shapes (61x45, a translucent disc and rectangle), clear (photo under a radial-gradient alpha), cloud (64x48, a blurred `plasma:fractal` alpha, `-seed 9`), a 40x30 `plasma:fractal` frame, one (1x1).

cwebp (each a lossy feature): q5 and q50 (`-q`), q95 (photo-m); seg1 (`-segments 1`: no segments), seg2 (`-segments 2 -sns 100`), sns0 (`-sns 0`); f0 (`-f 0`: no loop filter), sharp7 (`-f 80 -sharpness 7`), simple (`-nostrong`: the simple filter), simple-sharp (`-q 50 -nostrong -f 100 -sharpness 2`); odd, odd-tall (`-nostrong`), one; lossless (`-lossless`: VP8L).

cwebp alpha: alpha-raw (clear, `-alpha_method 0 -alpha_filter none`), alpha-fast (`-alpha_filter fast`: horizontal), alpha-q20 (`-alpha_q 20`: levels quantized, the pre-processing bit set), alpha-gradient (cloud, `-alpha_filter best`, which picks gradient), shapes (`-exact -alpha_method 0`). alpha-raw-f1, -f2 and -f3 are shapes with its raw alpha refiltered horizontal, vertical and gradient by a script, as cwebp only picks a filter itself.

ffmpeg's libvpx (`-frames:v 1 -c:v libvpx -pix_fmt yuv420p -f ivf`), the key frame wrapped in a RIFF `VP8 ` chunk by a script: they have loop filter deltas and token partitions, which cwebp doesn't make. vpx2 (`-slices 2 -qmin 20 -qmax 20`), vpx4 (`-slices 4`, q 40), vpx8 (photo-m, `-slices 8`, q 60: filter level 52), vpx-odd (odd, `-slices 4 -crf 4`: no filter), vpx-q0 (odd, q 0: a second-order DC quantizer delta).

webpmux: metadata (odd lossy with ICCP, EXIF and XMP), alpha-icc (shapes lossy with ICCP), lossless-meta (photo lossless in VP8X with ICCP and EXIF), lossless-alpha-meta (shapes `-lossless -exact` with EXIF); anim-offset (`-frame` the 40x30 frame `+100+10+6`, then photo, then shapes), anim-alpha (shapes at `+4+2` first, then photo). gif2webp: anim-gif (photo then odd, 32 colours: VP8L frames).

The reference PNGs were re-saved by PIL with `optimize=True` (same mode, same pixels).
