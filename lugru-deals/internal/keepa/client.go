package keepa

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ErrTokensErschoepft meldet ein leeres Kontingent samt Wartezeit, damit die
// Oberfläche eine konkrete Zeit nennen kann statt „später nochmal". Keepa
// legt die Wartezeit in den 429-Antwortkörper, nicht in einen Header. Liefert
// der Körper keine verwertbare Zahl – leer, kein JSON, oder ohne das Feld
// refillIn, etwa weil ein CDN oder eine WAF vor Keepa eine eigene Fehlerseite
// ausliefert –, bleibt Bekannt false. Ohne dieses Feld wäre eine unbekannte
// Wartezeit nicht von einer Wartezeit von null Sekunden zu unterscheiden.
type ErrTokensErschoepft struct {
	RefillIn time.Duration
	Bekannt  bool // false, wenn Keepa keine verwertbare Wartezeit lieferte
}

func (e ErrTokensErschoepft) Error() string {
	if !e.Bekannt {
		return "keepa: Kontingent erschöpft, Wartezeit unbekannt"
	}
	return fmt.Sprintf("keepa: Kontingent erschöpft, neue Token in %s", e.RefillIn.Round(time.Second))
}

type Client struct {
	Key           string
	HTTP          *http.Client
	BasisURL      string // in Tests überschrieben
	ChartBasisURL string
}

func NeuerClient(key string) *Client {
	return &Client{
		Key:           key,
		HTTP:          &http.Client{Timeout: 30 * time.Second},
		BasisURL:      "https://api.keepa.com",
		ChartBasisURL: "https://graph.keepa.com",
	}
}

// ohneKey liefert die Ursache eines *url.Error, ohne dessen URL.
//
// Produkt hängt den API-Key als Query-Parameter "key=..." an die Anfrage-URL
// (siehe unten). Sowohl http.NewRequestWithContext (beim Parsen einer
// kaputten URL) als auch http.Client.Do (bei einem Transportfehler wie
// DNS-Ausfall, Timeout oder Verbindungsabbruch) melden ihren Fehler laut
// Dokumentation als *url.Error, und dessen Error()-Methode zitiert per %q
// die komplette Anfrage- bzw. Parse-URL im Klartext: "parse \"<URL>\":
// <Grund>" bzw. "Get \"<URL>\": <Grund>". Ein fmt.Errorf mit %w auf einen
// solchen Fehler würde diese URL unverändert in die eigene Fehlermeldung
// übernehmen und damit den Key preisgeben — ganz gleich ob direkt sichtbar
// oder nur über errors.Unwrap erreichbar, denn %w ruft beim Formatieren
// Error() auf und bekäme exakt diesen String zurück.
//
// Das Feld Err ist dagegen die eigentliche Ursache (z. B. ein *net.DNSError
// bei einem unbekannten Host oder ein *net.OpError beim Verbindungsaufbau)
// und nennt laut Dokumentation von net/url und net/http nie die Anfrage-URL
// selbst — nur ggf. den Hostnamen, der für sich genommen kein Geheimnis ist.
// Für den unwahrscheinlichen Fall, dass hier trotzdem ein anderer Fehlertyp
// ankommt, wird auf dessen eigene Fehlermeldung zurückgefallen — die
// Web-Schicht scrubt zusätzlich als zweite Verteidigungslinie, falls doch
// einmal eine URL durchrutscht.
//
// Chart (siehe chart.go) nutzt denselben Helfer, obwohl der Chart-Endpunkt
// heute keinen Key kennt — nur ASIN und Marktplatz, beides keine
// Geheimnisse. Das hält beide Anfragepfade konsistent und verhindert, dass
// eine künftige, token-pflichtige Chart-Variante diesen Schutz vergisst.
//
// Analog zu ohneWebhookURL in internal/discord/webhook.go — dieselbe
// Fehlerklasse, derselbe Kunstgriff.
func ohneKey(err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) && uerr.Err != nil {
		return uerr.Err
	}
	return err
}

// Produkt holt eine ASIN von einem Marktplatz.
//
// stats=90 liefert die Durchschnitte, history=1 den Rohverlauf, aus dem der
// Median gerechnet wird. Der Quellmarktplatz wird bewusst nicht abgefragt: der
// Einkaufspreis stammt aus dem Warenkorb und enthält Mengenrabatte, die Keepa
// gar nicht kennt.
//
// Der dritte Rückgabewert ist der rohe Antwortkörper: internal/web speichert
// ihn unverändert im Keepa-Cache (siehe store.CacheSchreiben) und kann ihn
// später über ParseAntwort wieder in eine Antwort verwandeln, ohne erneut ein
// Token zu verbrauchen. Bei einem Fehler ist er nil.
func (c *Client) Produkt(ctx context.Context, asin string, domain int) (Antwort, []byte, error) {
	koerper, err := c.abfrage(ctx, url.Values{
		"domain":  {strconv.Itoa(domain)},
		"asin":    {asin},
		"stats":   {"90"},
		"history": {"1"},
	})
	if err != nil {
		return Antwort{}, nil, err
	}

	antwort, err := ParseAntwort(koerper)
	if err != nil {
		return Antwort{}, nil, err
	}
	return antwort, koerper, nil
}

// abfrage schickt eine Produktanfrage an Keepa und liefert den rohen
// Antwortkörper. Key, Kontingent und HTTP-Fehler behandelt sie für alle
// Anfragen gleich; q bringt nur die fachlichen Parameter mit.
func (c *Client) abfrage(ctx context.Context, q url.Values) ([]byte, error) {
	return c.senden(ctx, "product", q, nil)
}

// senden schickt eine Anfrage an einen Endpunkt der Keepa-API; mit Körper
// als POST mit JSON, sonst als GET.
func (c *Client) senden(ctx context.Context, pfad string, q url.Values, koerperRaus []byte) ([]byte, error) {
	if q == nil {
		q = url.Values{}
	}
	q.Set("key", c.Key)
	ziel := c.BasisURL + "/" + pfad + "?" + q.Encode()

	methode := http.MethodGet
	var rein io.Reader
	if koerperRaus != nil {
		methode, rein = http.MethodPost, bytes.NewReader(koerperRaus)
	}
	req, err := http.NewRequestWithContext(ctx, methode, ziel, rein)
	if err != nil {
		return nil, fmt.Errorf("keepa: Anfrage nicht baubar: %w", ohneKey(err))
	}
	if koerperRaus != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("keepa: nicht erreichbar: %w", ohneKey(err))
	}
	defer resp.Body.Close()

	koerper, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, fmt.Errorf("keepa: Antwort nicht lesbar: %w", err)
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		// Die Wartezeit steht im Körper, nicht im Header. refillIn wird über
		// einen Zeiger gelesen: so unterscheidet sich "Feld fehlt" (nil) von
		// "Feld ist 0" – nur damit bleibt eine unbekannte Wartezeit von einer
		// Wartezeit von null Sekunden unterscheidbar. Der Unmarshal-Fehler
		// wird nicht verworfen, sondern entscheidet direkt über Bekannt.
		var r struct {
			RefillIn *int `json:"refillIn"`
		}
		if err := json.Unmarshal(koerper, &r); err == nil && r.RefillIn != nil {
			return nil, ErrTokensErschoepft{
				RefillIn: time.Duration(*r.RefillIn) * time.Millisecond,
				Bekannt:  true,
			}
		}
		return nil, ErrTokensErschoepft{}
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("keepa: HTTP %d", resp.StatusCode)
	}

	return koerper, nil
}

// MaxJeAbfrage ist die größte Zahl ASINs, die Keepa in einer Abfrage nimmt.
const MaxJeAbfrage = 100

// Stapel ist das Ergebnis einer Abfrage mehrerer ASINs: je gefundenem
// Artikel das Produkt und seine Antwort in der Form einer Einzelabfrage
// (für den Cache, siehe store.CacheSchreiben).
type Stapel struct {
	Produkte       []Product
	Einzeln        [][]byte
	TokensLeft     int
	TokensConsumed int
	RefillRate     int
}

// Produkte holt bis zu MaxJeAbfrage ASINs eines Marktes in einer Abfrage —
// es kostet dasselbe wie einzeln (ein Token je ASIN), spart aber Zeit und
// Anfragen.
func (c *Client) Produkte(ctx context.Context, asins []string, domain int) (Stapel, error) {
	if len(asins) == 0 || len(asins) > MaxJeAbfrage {
		return Stapel{}, fmt.Errorf("keepa: 1 bis %d ASINs je Abfrage", MaxJeAbfrage)
	}
	koerper, err := c.abfrage(ctx, url.Values{
		"domain":  {strconv.Itoa(domain)},
		"asin":    {strings.Join(asins, ",")},
		"stats":   {"90"},
		"history": {"1"},
	})
	if err != nil {
		return Stapel{}, err
	}
	var r struct {
		TokensLeft     int               `json:"tokensLeft"`
		TokensConsumed int               `json:"tokensConsumed"`
		RefillRate     int               `json:"refillRate"`
		Products       []json.RawMessage `json:"products"`
		Error          *rohFehler        `json:"error"`
	}
	if err := json.Unmarshal(koerper, &r); err != nil {
		return Stapel{}, fmt.Errorf("keepa: Antwort nicht lesbar: %w", err)
	}
	if r.Error != nil && r.Error.Type != "" {
		return Stapel{}, fmt.Errorf("keepa: %s: %s", r.Error.Type, r.Error.Message)
	}
	st := Stapel{TokensLeft: r.TokensLeft, TokensConsumed: r.TokensConsumed, RefillRate: r.RefillRate}
	for _, roh := range r.Products {
		var rp rohProdukt
		if json.Unmarshal(roh, &rp) != nil || rp.ASIN == "" {
			continue
		}
		// Keepa liefert unbekannte ASINs als fast leeres Produkt ohne Titel
		// und ohne Verlauf.
		if rp.Title == "" && len(rp.CSV) == 0 {
			continue
		}
		st.Produkte = append(st.Produkte, produktAus(rp))
		st.Einzeln = append(st.Einzeln, append(append([]byte(`{"products":[`), roh...), []byte(`]}`)...))
	}
	return st, nil
}
