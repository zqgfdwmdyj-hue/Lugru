package keepa

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"
	"image/png"
)

// Untereinander setzt mehrere Charts zu einem einzigen PNG zusammen, das
// erste oben.
//
// Ein Bild statt mehrerer Anhänge: Discord zeigt zwei Bilder einer Nachricht
// nebeneinander, jedes nur halb so breit. Untereinander in einem Bild bleibt
// jeder Chart so breit wie ein einzelner.
//
// Ein einzelnes Bild geht unverändert zurück.
func Untereinander(bilder ...[]byte) ([]byte, error) {
	if len(bilder) == 1 {
		return bilder[0], nil
	}

	var teile []image.Image
	breite, hoehe := 0, 0
	for i, roh := range bilder {
		b, err := png.Decode(bytes.NewReader(roh))
		if err != nil {
			return nil, fmt.Errorf("keepa-chart: Bild %d nicht lesbar: %w", i+1, err)
		}
		teile = append(teile, b)
		breite = max(breite, b.Bounds().Dx())
		hoehe += b.Bounds().Dy()
	}
	if len(teile) == 0 {
		return nil, ErrKeinPNG
	}

	// Weiß als Grund: Keepas Charts haben einen weißen Hintergrund, und ein
	// schmaleres Bild soll nicht vor einem durchsichtigen Streifen stehen.
	ziel := image.NewRGBA(image.Rect(0, 0, breite, hoehe))
	draw.Draw(ziel, ziel.Bounds(), image.White, image.Point{}, draw.Src)

	y := 0
	for _, b := range teile {
		r := image.Rect(0, y, b.Bounds().Dx(), y+b.Bounds().Dy())
		draw.Draw(ziel, r, b, b.Bounds().Min, draw.Over)
		y += b.Bounds().Dy()
	}

	var puffer bytes.Buffer
	if err := png.Encode(&puffer, ziel); err != nil {
		return nil, fmt.Errorf("keepa-chart: Bild nicht schreibbar: %w", err)
	}
	return puffer.Bytes(), nil
}
