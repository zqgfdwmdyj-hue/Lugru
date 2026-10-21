package keepa

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func testPNG(t *testing.T, b, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, b, h))
	for y := 0; y < h; y++ {
		for x := 0; x < b; x++ {
			img.Set(x, y, color.RGBA{0xee, 0xee, 0xff, 0xff})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestMitBeschriftung(t *testing.T) {
	roh, err := MitBeschriftung(testPNG(t, 800, 350), "90 Tage")
	if err != nil {
		t.Fatal(err)
	}
	b, err := png.Decode(bytes.NewReader(roh))
	if err != nil {
		t.Fatal(err)
	}
	if b.Bounds().Dx() != 800 || b.Bounds().Dy() != 350+streifenHoehe {
		t.Errorf("Größe %v", b.Bounds())
	}
	// Im Etikett ist dunkler Grund, darunter beginnt der Chart.
	if r, _, _, _ := b.At(8, 6).RGBA(); r>>8 > 0x40 {
		t.Errorf("kein dunkles Etikett oben links")
	}
	if r, _, _, _ := b.At(400, streifenHoehe+10).RGBA(); r>>8 != 0xee {
		t.Errorf("Chart nicht unter dem Streifen")
	}
	if _, err := MitBeschriftung([]byte("kein PNG"), "x"); err == nil {
		t.Error("kein Fehler bei kaputtem Bild")
	}
}
