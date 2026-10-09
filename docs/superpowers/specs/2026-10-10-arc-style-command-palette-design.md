# msearch — Arc tarzı Chrome komut paleti (tasarım)

Tarih: 2026-10-10

## Amaç

Arc tarayıcısının Cmd+T komut çubuğunun Chrome'daki karşılığı. Tek bir arama kutusundan
açık sekmelere geçiş, geçmiş ve yer imi araması, web araması, URL'ye gitme ve sık
kullanılan tarayıcı komutlarını çalıştırma. Kullanıcı tek kişi (geliştirici), eklenti
"Load unpacked" ile yüklenir; mağaza yayını hedef değil.

Başarı ölçütü: herhangi bir sayfada kısayola basınca 100 ms içinde ortalanmış palet
açılır, yazdıkça sonuçlar güncellenir, Enter ile doğru eylem gerçekleşir, Esc kapatır.
chrome:// gibi overlay basılamayan sayfalarda aynı palet ayrı bir pencerede açılır.

## Kararlar

- **Teknoloji:** Vanilla JS (ES modules), Manifest V3, build adımı yok, bağımlılık yok.
- **Kısayol:** Varsayılan `Cmd+Shift+K` (Windows/Linux: `Ctrl+Shift+K`). Chrome, `Cmd+T`
  dahil bazı tuşları eklentilere vermiyor; kullanıcı `chrome://extensions/shortcuts`
  üzerinden değiştirebilir.
- **UI yeri:** Aktif sayfanın üstüne Shadow DOM içinde overlay. Content script
  enjekte edilemeyen sayfalarda (`chrome://`, `chrome-extension://`, Web Store, boş yeni
  sekme, dosya sayfaları izin verilmemişse) `chrome.windows.create({type:"popup"})` ile
  ortalanmış küçük bir pencerede aynı palet.
- **Kapsam dışı:** Spaces/profiller, split view, site içi arama kısayolları, senkron,
  tema özelleştirme (sadece sistem açık/koyu).

## Mimari

```
src/
  manifest.json
  background.js        service worker: kısayol, veri toplama, komut yürütme
  overlay.js           content script: Shadow DOM host, palette.js'i yükler
  palette/
    palette.html       yedek pencere
    palette.js         UI: input, liste, klavye; host'tan bağımsız
    palette.css        stil (overlay'de <style> olarak shadow root'a basılır)
    ranking.js         saf fonksiyonlar: eşleştirme + puanlama
    sources.js         (worker tarafı) sekme/geçmiş/yer imi/öneri/komut toplayıcılar
    commands.js        (worker tarafı) komut tanımları ve yürütücüleri
test/
  ranking.test.js      node --test ile çalışır
```

### Service worker (`background.js`)

- `chrome.commands.onCommand("open-palette")`: aktif sekmeye `{type:"toggle"}` mesajı
  gönderir. `chrome.runtime.lastError` / reddedilen promise (alıcı yok) → önce
  `chrome.scripting.executeScript` ile overlay.js'i enjekte etmeyi dener, o da başarısızsa
  yedek pencereyi açar. Yedek pencere zaten açıksa odaklar.
- `chrome.action.onClicked`: aynı akış.
- Mesajlar (UI → worker):
  - `{type:"query", text, tabId}` → `{results: Result[]}`
  - `{type:"execute", result, modifiers:{meta,shift}}` → `{ok:true}`
  - `{type:"close"}` → yedek pencereyse pencereyi kapatır.
- Yedek pencere `chrome.windows.onFocusChanged` ile odağı kaybedince kapanır.

### Content script (`overlay.js`)

- `document.documentElement` altına `<div id="msearch-host">` ekler, `attachShadow({mode:"closed"})`.
- Shadow root içine `palette.css` metnini `<style>` ile ve palette markup'ını basar.
- `palette.js`'i dinamik `import(chrome.runtime.getURL(...))` ile yükler; bu yüzden
  `web_accessible_resources` içinde `palette/*` listelenir.
- `toggle` mesajı: açıksa kapat, kapalıysa aç ve input'a odaklan.
- Esc, backdrop tıklaması → kapat. Kapanınca host DOM'da kalır (gizli), tekrar açılış hızlı.
- Sayfa `keydown`'larını palet açıkken `stopPropagation` ile yutar (sitenin kısayolları tetiklenmesin).

### Palet UI (`palette.js`)

- `createPalette({root, send, onClose})` döner `{open(), close(), isOpen()}`.
  `send(msg)` host tarafından verilir (overlay'de `chrome.runtime.sendMessage`, yedek
  pencerede de aynı; soyutlama test edilebilirlik için).
- Input'ta her değişiklikte 60 ms debounce ile `query` gönderir; son gönderilen
  sorgudan eski cevaplar atılır (sequence numarası).
- Liste: her satırda tür ikonu, başlık, ikincil metin (URL/host veya komut açıklaması),
  sağda "Switch to tab" / "Command" gibi etiket. Seçili satır vurgulu, ekrana kaydırılır.
- Klavye: `↑/↓` gezin, `Tab` = `↓`, `Shift+Tab` = `↑`, `Enter` seç, `Cmd/Ctrl+Enter` yeni
  sekmede aç, `Esc` kapat. Fare üzerine gelme seçimi değiştirir, tıklama seçer.
- Boş sorgu: son kullanılan 8 sekme + "New tab" komutu.

### Kaynaklar (`sources.js`, worker tarafı)

Hepsi paralel çağrılır (`Promise.allSettled`), başarısız olan atlanır:

| Kaynak | API | Not |
|---|---|---|
| tabs | `chrome.tabs.query({})` | `lastAccessed` ile yakınlık; mevcut sekme listeden çıkarılır |
| bookmarks | `chrome.bookmarks.search(text)` | sadece URL'si olanlar |
| history | `chrome.history.search({text, startTime: now-90d, maxResults: 50})` | `visitCount`, `lastVisitTime` |
| recently closed | `chrome.sessions.getRecentlyClosed({maxResults: 10})` | sadece tab girdileri |
| commands | `commands.js` listesi | ad + takma adlar üzerinden fuzzy |
| suggest | `https://suggestqueries.google.com/complete/search?client=chrome&q=` | 800 ms `AbortController` timeout, ayar kapalıysa çağrılmaz, en çok 5 |

### Sıralama (`ranking.js`, saf)

- `match(query, text) → score | null`: küçük harfe çevir; tam alt dize > kelime başı
  eşleşmesi > sırayla karakter (fuzzy) eşleşmesi. Başlık eşleşmesi URL eşleşmesinden
  daha değerli. Uzun metne göre normalize.
- `rank(query, candidates) → Result[]`: `score × typeWeight × recency`.
  typeWeight: tab 1.0, command 0.9, bookmark 0.8, recentlyClosed 0.7, history 0.6,
  suggest 0.5. recency: son 1 saat 1.0, 1 gün 0.9, 1 hafta 0.8, sonrası 0.7.
  History'de `log(visitCount+1)` çarpanı.
- Aynı URL birden fazla kaynakta varsa en yüksek puanlı tek kayıt kalır (tab > bookmark > history).
- Sona her zaman eklenir: `search` ("Search Google for …") ve metin URL/alan adı gibiyse
  `navigate` ("Go to …"). URL tespiti: `^[a-z]+://` veya `^[\w-]+(\.[\w-]+)+(/|$)`.
- Toplam en fazla 12 sonuç.

### Komutlar (`commands.js`)

| id | ad | takma ad | eylem |
|---|---|---|---|
| new-tab | New tab | nt, yeni sekme | `tabs.create` |
| close-tab | Close tab | ct, kapat | `tabs.remove(current)` |
| reopen-closed | Reopen closed tab | undo, geri aç | `sessions.restore()` |
| copy-url | Copy URL | url, kopyala | aktif sekmede `scripting.executeScript` ile `navigator.clipboard.writeText` |
| pin-tab | Pin / Unpin tab | pin, sabitle | `tabs.update({pinned:!pinned})` |
| mute-tab | Mute / Unmute tab | mute, sessiz | `tabs.update({muted:!muted})` |
| reload | Reload page | yenile | `tabs.reload` |
| duplicate | Duplicate tab | dup, çoğalt | `tabs.duplicate` |
| incognito | New incognito window | gizli | `windows.create({incognito:true})` |
| bookmark-page | Bookmark this page | yer imi | `bookmarks.create` |

Komutlar yalnızca sorgu boş değilse ve ad/takma ad eşleşiyorsa listelenir; boş sorguda
yalnızca "New tab" görünür.

### Eylem yürütme (`execute`)

| tür | varsayılan | Cmd/Ctrl+Enter |
|---|---|---|
| tab | `tabs.update(id,{active:true})` + `windows.update(focused)` | aynı |
| bookmark / history / recentlyClosed(url) | aynı sekmede aç (`tabs.update(current,{url})`) | yeni sekmede aç |
| suggest / search | Google araması aynı sekmede | yeni sekmede |
| navigate | URL'ye git (şema yoksa `https://` ekle) | yeni sekmede |
| command | `commands.js` yürütücüsü | aynı |

Yedek pencereden yürütülürken "mevcut sekme" = pencere açılmadan önce odaklı olan sekme
(worker, pencereyi açarken `tabId`'yi saklar). Eylem sonrası palet kapanır.

## Ayarlar (`storage.sync`)

- `suggestEnabled` (varsayılan true)
- `searchEngine`: `google` | `duckduckgo` | `bing` (varsayılan google; sadece arama URL şablonu)

Basit bir `options.html` (iki alan). Gelişmiş ayar yok.

## İzinler (`manifest.json`)

`tabs`, `history`, `bookmarks`, `sessions`, `scripting`, `storage`, `activeTab`;
`host_permissions`: `<all_urls>`, `https://suggestqueries.google.com/*`.
`content_scripts`: `overlay.js`, `<all_urls>`, `run_at: document_idle`.

## Hata yönetimi

- Overlay'e mesaj ulaşmazsa → enjekte etmeyi dene → olmazsa yedek pencere. Kullanıcıya
  hata gösterilmez, sadece doğru host açılır.
- Öneri isteği timeout/ağ hatası → öneri yok, diğer sonuçlar normal gelir.
- Kaynak API'lerinden biri hata verirse (`allSettled`) o kaynak atlanır.
- `execute` hatası → UI'da satırın altında kısa kırmızı metin ("Couldn't close tab"), palet
  açık kalır.
- Yedek pencere pozisyonu: `chrome.windows.getCurrent` ile ekran boyutuna göre ortalama;
  alınamazsa 600×420 varsayılan.

## Test

- `test/ranking.test.js` (`node --test`): match sıralaması, tür ağırlıkları, URL
  tespiti, tekilleştirme, boş sorgu davranışı, 12 sınırı.
- `test/commands.test.js`: komut eşleştirme (ad ve takma adlar).
- Elle kontrol listesi (README'de): normal sayfada kısayol, chrome://extensions'da yedek
  pencere, sekme geçişi, Cmd+Enter yeni sekme, Esc, dışarı tıklama, siteyle CSS çakışması
  (ör. GitHub, Gmail), öneri kapalıyken ağ isteği olmaması (DevTools Network).
