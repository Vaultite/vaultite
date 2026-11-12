# PNG fixtures

All from one 37x23 picture drawn by PIL 12 (seeded noise, ramps, an alpha ramp). ImageMagick wrote rgb8, rgb16, rgba8, rgba16, gray1/2/4/8/16, graya8/16, pal8, pal-trns (PNG8: alpha in the palette), rgb8-adam7, rgba16-adam7 and gray2-adam7 (`-interlace PNG`), and dot (1x1). PIL wrote pal1/2/4 (`quantize`, `bits=`), and rgb-key and gray8-key (a tRNS colour key).

References (`<name>.ref.png`) are PIL's RGBA, but gray16's is ImageMagick's `-depth 8`, as PIL clips 16-bit grey.
