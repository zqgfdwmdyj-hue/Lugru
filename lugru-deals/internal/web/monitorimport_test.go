package web

import (
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

const marvinsListe = "Artikel\tPreiswecker\tBester Ankauf\tHinweis\n" +
	"PlayStation 5 Pro 0711719024040\t1116\t1175 € (lost, Zero4K)\t1180 € ab 6 Stk (Zero4K)\n" +
	"PS5 Disc Edition\t612\t645 € (serix)\tnur ab 4 Stk; einzeln 600 € (Zero4K), dann Wecker auf 570\n" +
	"DualSense Controller Weiß\t56,50\t59,50 € (serix)\tAngebot war 50 € netto, er sucht 10 Stk\n" +
	"Xbox Series X 1TB Digital Weiß\t640\t674 € (Emre)\t\n" +
	"\n" +
	"Starlink\n" +
	"\n" +
	"Artikel\tPreiswecker\tBester Ankauf\tHinweis\n" +
	"Starlink Mini Kit\t289\t305 € (ThisIsTheWay, Zero4K)\t310 € ab 15 Stk (Zero4K)\n"

func TestLiesImport(t *testing.T) {
	z := liesImport(marvinsListe)
	if len(z) != 5 {
		t.Fatalf("%d Zeilen: %+v", len(z), z)
	}
	pro := z[0]
	if pro.Name != "PlayStation 5 Pro" || pro.EAN != "0711719024040" || pro.Wecker != 111600 || pro.Ankauf != 117500 || pro.Kategorie != "" {
		t.Errorf("PS5 Pro = %+v", pro)
	}
	if len(pro.Ankaeufer) != 2 || pro.Ankaeufer[1].AbStueck != 6 || pro.Ankaeufer[1].Preis != 118000 || pro.Ankaeufer[0].Name != "lost, Zero4K" {
		t.Errorf("Ankäufer = %+v", pro.Ankaeufer)
	}
	// „nur ab 4 Stk; einzeln 600 €": Einzelpreis ist 600, 645 gilt ab 4.
	disc := z[1]
	if disc.Ankauf != 60000 {
		t.Errorf("Disc Ankauf = %d, will 60000", disc.Ankauf)
	}
	ab4 := false
	for _, a := range disc.Ankaeufer {
		if a.Preis == 64500 && a.AbStueck == 4 {
			ab4 = true
		}
	}
	if !ab4 {
		t.Errorf("Disc-Staffel fehlt: %+v", disc.Ankaeufer)
	}
	if z[2].Wecker != money.Cents(5650) || z[2].Ankauf != 5950 {
		t.Errorf("Controller = %+v", z[2])
	}
	if z[4].Kategorie != "Starlink" || z[4].Ankauf != 30500 {
		t.Errorf("Starlink = %+v", z[4])
	}
	if z[0].Stichworte == "" || z[2].Stichworte == "dualsense controller weiß" {
		t.Errorf("Stichworte = %q / %q", z[0].Stichworte, z[2].Stichworte)
	}
}
