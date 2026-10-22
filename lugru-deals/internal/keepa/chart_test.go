package keepa

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestChartURL(t *testing.T) {
	c := NeuerClient("geheim")
	roh := c.ChartURL("B01636IZ0G", "de", StandardChart)

	u, err := url.Parse(roh)
	if err != nil {
		t.Fatalf("URL nicht parsebar: %v", err)
	}
	if !strings.HasSuffix(u.Path, "/pricehistory.png") {
		t.Errorf("Pfad = %q, will /pricehistory.png", u.Path)
	}
	if strings.Contains(roh, "geheim") {
		t.Error("der Chart-Endpunkt braucht keinen Key — er darf nicht in der URL stehen")
	}

	q := u.Query()
	for schluessel, will := range map[string]string{
		"asin": "B01636IZ0G", "domain": "de", "range": "90",
		"width": "800", "height": "350", "bb": "1", "amazon": "1", "new": "1",
	} {
		if got := q.Get(schluessel); got != will {
			t.Errorf("Parameter %s = %q, will %q", schluessel, got, will)
		}
	}
}

func TestChartURLKurvenAbschaltbar(t *testing.T) {
	c := NeuerClient("geheim")
	o := StandardChart
	o.BuyBox = false
	q, _ := url.Parse(c.ChartURL("B01636IZ0G", "de", o))
	if q.Query().Has("bb") {
		t.Error("bb steht in der URL, obwohl die Kurve abgeschaltet ist")
	}
}

func TestChartHolen(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("x", 100))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write(png)
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.BasisURL = srv.URL

	got, err := c.Chart(context.Background(), "B01636IZ0G", 3, StandardChart)
	if err != nil {
		t.Fatalf("Chart: %v", err)
	}
	if len(got) != len(png) {
		t.Errorf("%d Bytes, will %d", len(got), len(png))
	}
}

func TestChartKeinPNG(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<html>Wartungsarbeiten</html>"))
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.BasisURL = srv.URL

	if _, err := c.Chart(context.Background(), "B01636IZ0G", 3, StandardChart); !errors.Is(err, ErrKeinPNG) {
		t.Errorf("will ErrKeinPNG, bekam %v", err)
	}
}

// TestChartContentTypeOhneMagicBytes deckt den Fall ab, dass eine Antwort
// sich per Content-Type als PNG ausgibt, ihr Koerper aber nicht mit der
// PNG-Signatur beginnt. Chart() prueft beides — Header und Magic Bytes —,
// aber bislang testete kein Fall die Kombination "Header sagt PNG, Bytes
// sagen nein". Ohne diesen Test wuerde eine Regression, die die
// Magic-Byte-Pruefung entfernt, unbemerkt bleiben.
func TestChartContentTypeOhneMagicBytes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("das hier ist nur Text, kein PNG"))
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.BasisURL = srv.URL

	if _, err := c.Chart(context.Background(), "B01636IZ0G", 3, StandardChart); !errors.Is(err, ErrKeinPNG) {
		t.Errorf("will ErrKeinPNG, bekam %v", err)
	}
}

func TestUntereinander(t *testing.T) {
	bild := func(b, h int) []byte {
		var puffer bytes.Buffer
		if err := png.Encode(&puffer, image.NewRGBA(image.Rect(0, 0, b, h))); err != nil {
			t.Fatal(err)
		}
		return puffer.Bytes()
	}

	roh, err := Untereinander(bild(800, 350), bild(800, 200))
	if err != nil {
		t.Fatalf("Untereinander: %v", err)
	}
	b, err := png.Decode(bytes.NewReader(roh))
	if err != nil {
		t.Fatalf("Ergebnis ist kein PNG: %v", err)
	}
	if got := b.Bounds().Size(); got != image.Pt(800, 550) {
		t.Errorf("Größe = %v, will 800x550", got)
	}

	einzeln := bild(10, 10)
	if roh, _ := Untereinander(einzeln); !bytes.Equal(roh, einzeln) {
		t.Error("ein einzelnes Bild wurde verändert")
	}
}

// Der Graph "Monatlich verkauft" ist eine eigene Anfrage — in graphimage
// verträgt sich monthlysold nicht mit den Preis-Kurven einer Anfrage.
func TestVerkaufsChart(t *testing.T) {
	gelb := func() []byte {
		img := image.NewRGBA(image.Rect(0, 0, 200, 80))
		for x := 10; x < 190; x++ {
			img.Set(x, 40, color.RGBA{0xf6, 0xd5, 0x00, 0xff})
		}
		var buf bytes.Buffer
		_ = png.Encode(&buf, img)
		return buf.Bytes()
	}
	var mitGelb = true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("monthlysold") != "1" || q.Has("bb") || q.Has("salesrank") || q.Get("range") != "30" {
			t.Errorf("Anfrage: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "image/png")
		if mitGelb {
			w.Write(gelb())
			return
		}
		// So sieht Keepas "Invalid request" aus: ein gültiges PNG ohne Linie.
		var buf bytes.Buffer
		_ = png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 200, 80)))
		w.Write(buf.Bytes())
	}))
	defer srv.Close()
	c := &Client{BasisURL: srv.URL, Key: "k", HTTP: srv.Client()}

	if _, err := c.VerkaufsChart(context.Background(), "B01636IZ0G", 3, 30, 800, 160); err != nil {
		t.Errorf("gültiger Graph abgelehnt: %v", err)
	}
	mitGelb = false
	if _, err := c.VerkaufsChart(context.Background(), "B01636IZ0G", 3, 30, 800, 160); !errors.Is(err, ErrKeineVerkaufsdaten) {
		t.Errorf("Fehlerbild nicht erkannt: %v", err)
	}
}
