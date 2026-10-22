package podcast

import (
	"os"
	"testing"
)

func TestLiesCharts(t *testing.T) {
	roh, _ := os.ReadFile("testdata/charts.json")
	ps, err := LiesCharts(roh)
	if err != nil || len(ps) != 3 || ps[0].ID == "" || ps[0].Name == "" || ps[0].Bild == "" {
		t.Fatalf("%+v %v", ps, err)
	}
}

func TestLiesFolgen(t *testing.T) {
	roh, _ := os.ReadFile("testdata/folgen.xml")
	fs, err := LiesFolgen(roh)
	if err != nil || len(fs) != 2 {
		t.Fatalf("%+v %v", fs, err)
	}
	if fs[0].Podcast != "The Daily" || fs[0].Dauer != "32 Min." || fs[0].Zeit.IsZero() || fs[0].ID == "" {
		t.Errorf("Folge = %+v", fs[0])
	}
}

func TestAppleID(t *testing.T) {
	for roh, will := range map[string]string{
		"https://podcasts.apple.com/de/podcast/the-daily/id1200361736": "1200361736",
		"1200361736": "1200361736",
		"https://itunes.apple.com/lookup?id=1200361736": "1200361736",
	} {
		if got, ok := AppleID(roh); !ok || got != will {
			t.Errorf("%q → %q", roh, got)
		}
	}
	if _, ok := AppleID("https://feeds.simplecast.com/Sl5CSM3S"); ok {
		t.Error("Feed als Apple-ID erkannt")
	}
	if dauerText("3725") != "1 Std. 2 Min." || dauerText("") != "" {
		t.Error("Dauer")
	}
}
