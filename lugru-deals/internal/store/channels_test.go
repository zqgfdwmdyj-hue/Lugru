package store

import "testing"

func TestChannelRunde(t *testing.T) {
	s := temp(t)

	id, err := s.ChannelAnlegen(Channel{
		Name: "deals-vip", WebhookURL: "https://discord.com/api/webhooks/1/abc",
		MentionTyp: "everyone",
	})
	if err != nil {
		t.Fatalf("ChannelAnlegen: %v", err)
	}
	if id == 0 {
		t.Fatal("ChannelAnlegen lieferte ID 0")
	}

	c, err := s.Channel(id)
	if err != nil {
		t.Fatalf("Channel: %v", err)
	}
	if c.Name != "deals-vip" || c.MentionTyp != "everyone" {
		t.Errorf("Channel = %+v", c)
	}
	if c.AngelegtAm.IsZero() {
		t.Error("AngelegtAm ist nicht gesetzt")
	}

	c.Name = "deals-intern"
	c.MentionTyp = "keine"
	if err := s.ChannelAendern(c); err != nil {
		t.Fatalf("ChannelAendern: %v", err)
	}
	c2, _ := s.Channel(id)
	if c2.Name != "deals-intern" || c2.MentionTyp != "keine" {
		t.Errorf("nach Ändern: %+v", c2)
	}

	if err := s.ChannelDefekt(id, true); err != nil {
		t.Fatalf("ChannelDefekt: %v", err)
	}
	if c3, _ := s.Channel(id); !c3.Defekt {
		t.Error("Defekt = false nach ChannelDefekt(true)")
	}

	if err := s.ChannelLoeschen(id); err != nil {
		t.Fatalf("ChannelLoeschen: %v", err)
	}
	if _, err := s.Channel(id); err == nil {
		t.Error("gelöschter Channel ist noch abrufbar")
	}
}

func TestChannelsSortiertNachName(t *testing.T) {
	s := temp(t)
	for _, name := range []string{"zulu", "alpha", "mike"} {
		if _, err := s.ChannelAnlegen(Channel{Name: name, WebhookURL: "https://x/" + name}); err != nil {
			t.Fatalf("ChannelAnlegen(%s): %v", name, err)
		}
	}
	cs, err := s.Channels()
	if err != nil {
		t.Fatalf("Channels: %v", err)
	}
	will := []string{"alpha", "mike", "zulu"}
	if len(cs) != len(will) {
		t.Fatalf("%d Channels, will %d", len(cs), len(will))
	}
	for i, w := range will {
		if cs[i].Name != w {
			t.Errorf("Channels[%d] = %q, will %q", i, cs[i].Name, w)
		}
	}
}
