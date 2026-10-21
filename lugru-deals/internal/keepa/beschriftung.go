package keepa

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"sync"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// Mit Beschriftung: über jeden Chart kommt ein schmaler Streifen mit dem
// Zeitraum ("90 Tage"). Keepas Bild selbst nennt ihn nur über die Datumsachse,
// und bei zwei Charts untereinander fragt sonst jeder, welcher welcher ist.

const streifenHoehe = 30

var (
	schriftEinmal sync.Once
	schrift       font.Face
	schriftFehler error
)

func streifenSchrift() (font.Face, error) {
	schriftEinmal.Do(func() {
		f, err := opentype.Parse(gobold.TTF)
		if err != nil {
			schriftFehler = err
			return
		}
		schrift, schriftFehler = opentype.NewFace(f, &opentype.FaceOptions{Size: 17, DPI: 72, Hinting: font.HintingFull})
	})
	return schrift, schriftFehler
}

// MitBeschriftung setzt einen Streifen mit text über das Bild.
func MitBeschriftung(roh []byte, text string) ([]byte, error) {
	b, err := png.Decode(bytes.NewReader(roh))
	if err != nil {
		return nil, fmt.Errorf("keepa-chart: Bild nicht lesbar: %w", err)
	}
	face, err := streifenSchrift()
	if err != nil {
		return nil, fmt.Errorf("keepa-chart: Schrift nicht ladbar: %w", err)
	}
	breite, hoehe := b.Bounds().Dx(), b.Bounds().Dy()
	ziel := image.NewRGBA(image.Rect(0, 0, breite, hoehe+streifenHoehe))
	draw.Draw(ziel, ziel.Bounds(), image.White, image.Point{}, draw.Src)

	// Ein dunkles Etikett links, weiße Schrift: hebt sich vom weißen Chart ab
	// und vom dunklen Discord-Hintergrund gleichermaßen.
	d := &font.Drawer{Dst: ziel, Src: image.White, Face: face}
	textBreite := d.MeasureString(text).Ceil()
	etikett := image.Rect(6, 4, 6+textBreite+20, streifenHoehe-2)
	draw.Draw(ziel, etikett, image.NewUniform(color.RGBA{0x1f, 0x29, 0x37, 0xff}), image.Point{}, draw.Src)
	d.Dot = fixed.P(16, streifenHoehe-9)
	d.DrawString(text)

	draw.Draw(ziel, image.Rect(0, streifenHoehe, breite, hoehe+streifenHoehe), b, b.Bounds().Min, draw.Over)
	var puffer bytes.Buffer
	if err := png.Encode(&puffer, ziel); err != nil {
		return nil, fmt.Errorf("keepa-chart: Bild nicht schreibbar: %w", err)
	}
	return puffer.Bytes(), nil
}
