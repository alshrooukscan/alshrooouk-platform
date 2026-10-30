"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { theme } from "../../../../lib/theme";
import { useT, tx, Ltr } from "../../../../lib/i18n";
import LanguageToggle from "../../../../lib/i18n/LanguageToggle";

// Was deliberately un-branded, styled like a standalone shopping site. Doctors
// reach it from their portal, so arriving at a page with a different header and
// a different navy read as a different system - and one asking them to spend
// money, which is exactly where a brand should be recognisable. It now carries
// the same logo, navy and gold as the rest of the platform.
// Small square control for the quantity steppers, sized for a thumb since this
// is used on a phone at the chairside.
const stepBtn = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: "1px solid #ddd",
  background: "#fff",
  color: theme.navy,
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1,
  cursor: "pointer",
};

export default function DentalStockShopPage() {
  const { t, isAr } = useT();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState({}); // { stock_item_id: quantity }
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orderSplit, setOrderSplit] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [reqName, setReqName] = useState("");
  const [reqQty, setReqQty] = useState("");
  const [reqNote, setReqNote] = useState("");

  async function sendRequest() {
    setRequestError("");
    if (!reqName.trim()) {
      setRequestError(tx("Tell us what you need."));
      return;
    }
    setRequestBusy(true);
    const res = await fetch("/api/portal/doctor/dental-stock/request-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemName: reqName, quantity: reqQty, note: reqNote }),
    });
    const result = await res.json().catch(() => ({}));
    setRequestBusy(false);
    if (!res.ok) {
      setRequestError(result.error || tx("Could not send that request."));
      return;
    }
    setRequestSent(true);
  }
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [payLater, setPayLater] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  // Opens on what can actually be had today. Out of stock is one tap away, not
  // hidden: those items are still orderable and become backorders.
  const [stockView, setStockView] = useState("in");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/portal/doctor/dental-stock")
      .then((r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((d) => {
        setItems(d.items || []);
        setLoading(false);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  // Typing 0 into the box already removed a line, but nothing said so and
  // there was no way to nudge a quantity up or down or take something out
  // once it was in the cart. A doctor who over-ordered had to clear the box
  // and guess, or reload the page.
  function stepQty(itemId, delta, max) {
    setCart((c) => {
      const next = { ...c };
      const n = (next[itemId] || 0) + delta;
      if (n <= 0) delete next[itemId];
      else next[itemId] = max ? Math.min(n, max) : n;
      return next;
    });
  }
  function removeFromCart(itemId) {
    setCart((c) => {
      const next = { ...c };
      delete next[itemId];
      return next;
    });
  }

  function addToCart(itemId) {
    setCart((c) => ({ ...c, [itemId]: (c[itemId] || 0) + 1 }));
  }
  function setQty(itemId, qty) {
    const n = Math.max(0, Number(qty) || 0);
    setCart((c) => {
      const next = { ...c };
      if (n === 0) delete next[itemId];
      else next[itemId] = n;
      return next;
    });
  }

  const cartLines = Object.entries(cart)
    .map(([id, qty]) => {
      const item = items.find((i) => i.id === id);
      return item ? { ...item, qty } : null;
    })
    .filter(Boolean);
  const cartTotal = cartLines.reduce((s, l) => s + Number(l.sale_price) * l.qty, 0);
  // One pass over the catalogue: the two tab counts and the list being shown all
  // come from the same definition of "in stock".
  // qty_available, NOT qty_remaining. This route deliberately never sends
  // qty_remaining - it sends what is on the shelf minus what is already
  // promised to another order - so filtering on qty_remaining read undefined
  // on every item and put the whole catalogue in Out of stock, while a card
  // inside it still said "6 in stock" from the field the route does send.
  // It is also the right rule: stock spoken for by someone else is not stock
  // this doctor can have.
  const inStock = items.filter((i) => Number(i.qty_available || 0) > 0);
  const outOfStock = items.filter((i) => Number(i.qty_available || 0) <= 0);
  const inStockCount = inStock.length;
  const outOfStockCount = outOfStock.length;
  const shownItems = [...(stockView === "in" ? inStock : outOfStock)].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""))
  );

  const cartCount = cartLines.reduce((s, l) => s + l.qty, 0);

  async function confirmOrder() {
    setPlacing(true);
    setError("");
    const res = await fetch("/api/portal/doctor/dental-stock/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentMethod,
        payLater,
        items: cartLines.map((l) => ({ stockItemId: l.id, quantity: l.qty })),
      }),
    });
    const result = await res.json();
    setPlacing(false);
    if (!res.ok) {
      setError(result.error || tx("Something went wrong placing this order."));
      return;
    }
    setConfirmedOrder(result.orderId);
    setOrderSplit({ hasBackorder: !!result.hasBackorder, hasInStock: !!result.hasInStock });
    setCart({});
    setCheckoutOpen(false);
  }

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>{t("Loading...")}</div>;
  }

  if (confirmedOrder) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#f7f7f8" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 40, textAlign: "center", maxWidth: 380, boxShadow: "0 8px 30px rgba(0,0,0,0.08)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{"\u2705"}</div>
          <h2 style={{ margin: "0 0 8px" }}>{t("Order Confirmed")}</h2>
          <p style={{ color: "#666", fontSize: 14, marginBottom: orderSplit?.hasBackorder ? 12 : 24 }}>
            {t("Your order has been placed and sent to the team for fulfillment.")}
          </p>
          {orderSplit?.hasBackorder && (
            <p style={{ background: "#fff8e1", border: "1px solid #f0d58c", color: "#8a6d00", fontSize: 13, lineHeight: 1.5, borderRadius: 8, padding: "10px 12px", marginBottom: 24, textAlign: "start" }}>
              {orderSplit.hasInStock
                ? t("Some of what you ordered is out of stock, so it has been split into two orders: the available items are being prepared now, and the rest will be delivered once they arrive.")
                : t("These items are currently out of stock. Your order is recorded and will be delivered once they arrive.")}
              {" "}{t("You can follow both on your portal home page.")}
            </p>
          )}
          <button
            onClick={() => setConfirmedOrder(null)}
            style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            {t("Continue Shopping")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui", background: "#f7f7f8" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 10, boxShadow: "0 2px 10px rgba(39,33,77,0.08)" }}>
      <div style={{ background: theme.navy, padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* The only way off this page used to be the browser's back button.
              A doctor who arrived here by tapping "Request Dental Stock Items"
              had no marked route home. */}
          <button
            onClick={() => router.push("/portal/doctor")}
            title={t("Back to your portal")}
            style={{
              background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)",
              color: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 13,
              fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {isAr ? "\u203a" : "\u2039"} {t("Back")}
          </button>
          <img src="/logo-mark.png" alt="" style={{ height: 30, width: "auto" }} />
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>Al Shrooouk Scan &amp; Lab</div>
            <div style={{ color: theme.goldLight, fontSize: 12 }}>{t("Dental Supplies")}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <LanguageToggle compact style={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} />
        <button
          onClick={() => setCheckoutOpen(true)}
          disabled={cartCount === 0}
          style={{
            padding: "10px 20px", borderRadius: 999, border: "none", fontWeight: 700, fontSize: 14, cursor: cartCount ? "pointer" : "default",
            // Gold on the navy bar: a navy button on a navy header disappears.
            background: cartCount ? `linear-gradient(135deg, ${theme.gold}, ${theme.goldLight})` : "rgba(255,255,255,0.15)",
            color: cartCount ? theme.navy : "rgba(255,255,255,0.6)",
          }}
        >
          {t("Cart ({n})", { n: cartCount })} {cartTotal > 0 && `\u2013 ${t("{amount} EGP", { amount: cartTotal.toFixed(2) })}`}
        </button>
        </div>
      </div>

      {/* Second row, inside the same sticky wrapper so both stay put while a
          doctor scrolls 246 items - the filters are useless if you have to
          scroll back to the top to reach them. Requesting an unlisted item sits
          directly beside the filters: it is the third thing you might do here,
          not a far-right afterthought. */}
      <div
        style={{
          background: "#fff", borderBottom: "1px solid #eceaf1", padding: "12px 24px",
          display: "flex", gap: 8, alignItems: "center", justifyContent: "center", flexWrap: "wrap",
        }}
      >
        {[
          { key: "in", label: "In stock", n: inStockCount },
          { key: "out", label: "Out of stock", n: outOfStockCount },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStockView(tab.key)}
            style={{
              padding: "9px 18px", borderRadius: 999,
              border: `1px solid ${stockView === tab.key ? theme.navy : "#ddd"}`,
              background: stockView === tab.key ? theme.navy : "#fff",
              color: stockView === tab.key ? "#fff" : theme.navy,
              fontWeight: 600, fontSize: 13, cursor: "pointer",
            }}
          >
            {t(tab.label)} ({tab.n})
          </button>
        ))}
        <button
          onClick={() => setRequestOpen(true)}
          style={{
            padding: "9px 18px", borderRadius: 999,
            border: `1px solid ${theme.gold}`, background: "#fff", color: theme.navy,
            fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}
        >
          {t("Request an item we don't list")}
        </button>
      </div>
      </div>

      {requestOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 380, maxWidth: "100%" }}>
            <h3 style={{ marginTop: 0 }}>{t("Request an item")}</h3>
            <p style={{ fontSize: 12, color: "#666", marginTop: -6 }}>
              {t("Something we don't carry. We'll look into sourcing it and get back to you. This is not an order.")}
            </p>
            {requestSent ? (
              <>
                <p style={{ fontSize: 14, color: "#1e7a3c", fontWeight: 600 }}>{t("Request sent. Thank you.")}</p>
                <button onClick={() => { setRequestOpen(false); setRequestSent(false); setReqName(""); setReqQty(""); setReqNote(""); }}
                  style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
                  {t("Close")}
                </button>
              </>
            ) : (
              <>
                <label style={{ fontSize: 12, fontWeight: 600 }}>{t("Item name")}</label>
                <input value={reqName} onChange={(e) => setReqName(e.target.value)} placeholder={t("What do you need?")}
                  style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #ddd", margin: "6px 0 12px", boxSizing: "border-box" }} />
                <label style={{ fontSize: 12, fontWeight: 600 }}>{t("Quantity (optional)")}</label>
                <input type="number" min={1} value={reqQty} onChange={(e) => setReqQty(e.target.value)}
                  style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #ddd", margin: "6px 0 12px", boxSizing: "border-box" }} />
                <label style={{ fontSize: 12, fontWeight: 600 }}>{t("Notes (brand, size, anything that helps)")}</label>
                <input value={reqNote} onChange={(e) => setReqNote(e.target.value)}
                  style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #ddd", margin: "6px 0 14px", boxSizing: "border-box" }} />
                {requestError && <p style={{ color: "#ba1a1a", fontSize: 12 }}>{t(requestError)}</p>}
                <button onClick={sendRequest} disabled={requestBusy}
                  style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
                  {requestBusy ? t("Sending...") : t("Send request")}
                </button>
                <button onClick={() => setRequestOpen(false)}
                  style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
                  {t("Cancel")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Was capped at 1000px, which left most of a desktop screen empty either
          side while the catalogue ran to 246 items. It fills the width now, so
          a wide screen gets more cards per row instead of more scrolling. The
          220px minimum still holds, so a phone drops to one column. */}
      <div style={{ padding: "24px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 20 }}>
        {items.length === 0 && <p style={{ color: "#666" }}>{t("No items in the catalogue yet.")}</p>}
        {items.length > 0 && shownItems.length === 0 && (
          <p style={{ color: "#666", gridColumn: "1 / -1" }}>
            {stockView === "in"
              ? t("Nothing is in stock right now. Check Out of stock \u2013 you can still order and it will follow when it arrives.")
              : t("Everything in the catalogue is in stock.")}
          </p>
        )}
        {shownItems.map((item) => (
          <div key={item.id} style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ height: 140, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {item.image_url ? (
                <img src={item.image_url} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ color: "#bbb", fontSize: 12 }}>{t("No image")}</span>
              )}
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{item.name}</div>
              <div style={{ color: theme.navy, fontWeight: 700, fontSize: 15, marginBottom: 6 }}><Ltr>{t("{amount} EGP", { amount: Number(item.sale_price).toFixed(2) })}</Ltr></div>
              {/* The real count, not just a hidden maximum. A doctor ordering
                  supplies needs to know whether we hold 2 or 40 before deciding
                  how much to ask for. */}
              {item.qty_available > 0 ? (
                <div style={{ fontSize: 12, color: "#1e7a3c", fontWeight: 600, marginBottom: 10 }}>
                  {t("{n} in stock", { n: item.qty_available })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#8a6d00", background: "#fff8e1", border: "1px solid #f0d58c", borderRadius: 6, padding: "6px 8px", marginBottom: 10, lineHeight: 1.4 }}>
                  {t("Currently out of stock. You can still order it and we will deliver it once it arrives.")}
                </div>
              )}
              {cart[item.id] ? (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => stepQty(item.id, -1)} aria-label={t("Remove one {name}", { name: item.name })} style={stepBtn}>&minus;</button>
                    <input
                      type="number"
                      min={1}
                      // An out-of-stock line is a backorder, so it is not
                      // capped by what happens to be on the shelf.
                      max={item.qty_available > 0 ? item.qty_available : undefined}
                      value={cart[item.id]}
                      onChange={(e) => setQty(item.id, e.target.value)}
                      style={{ width: 54, padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd", textAlign: "center" }}
                    />
                    <button
                      onClick={() => stepQty(item.id, 1, item.qty_available > 0 ? item.qty_available : null)}
                      aria-label={t("Add one {name}", { name: item.name })}
                      style={stepBtn}
                    >
                      +
                    </button>
                    <button onClick={() => removeFromCart(item.id)} style={{ ...stepBtn, width: "auto", padding: "0 10px", color: "#8c1d18", borderColor: "#f0c9c9" }}>
                      {t("Remove")}
                    </button>
                  </div>
                  {item.qty_available > 0 && cart[item.id] >= item.qty_available && (
                    <p style={{ fontSize: 11, color: "#8a6d00", margin: "6px 0 0" }}>
                      {t("That is all we have in stock right now.")}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => addToCart(item.id)}
                  style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: `1px solid ${theme.navy}`, background: "#fff", color: theme.navy, fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                >
                  {item.qty_available > 0 ? t("Add to Cart") : t("Order for later")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {checkoutOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20, padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 360, maxHeight: "85vh", overflowY: "auto" }}>
            <h3 style={{ marginTop: 0 }}>{t("Checkout")}</h3>
            {cartLines.length === 0 && (
              <p style={{ fontSize: 13, color: "#666" }}>{t("Your cart is empty. Close this to keep browsing.")}</p>
            )}
            {cartLines.map((l) => (
              <div key={l.id} style={{ fontSize: 13, padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{l.name}</span>
                  <span><Ltr>{t("{amount} EGP", { amount: (Number(l.sale_price) * l.qty).toFixed(2) })}</Ltr></span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <button onClick={() => stepQty(l.id, -1)} aria-label={t("Remove one {name}", { name: l.name })} style={stepBtn}>&minus;</button>
                  <span style={{ minWidth: 22, textAlign: "center" }}>{l.qty}</span>
                  <button onClick={() => stepQty(l.id, 1, l.qty_available > 0 ? l.qty_available : null)} aria-label={t("Add one {name}", { name: l.name })} style={stepBtn}>+</button>
                  <button onClick={() => removeFromCart(l.id)} style={{ ...stepBtn, width: "auto", padding: "0 10px", color: "#8c1d18", borderColor: "#f0c9c9" }}>
                    {t("Remove")}
                  </button>
                  {l.qty_available <= 0 && (
                    <span style={{ fontSize: 11, color: "#8a6d00" }}>{t("awaiting stock")}</span>
                  )}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, padding: "10px 0" }}>
              <span>{t("Total")}</span>
              <span><Ltr>{t("{amount} EGP", { amount: cartTotal.toFixed(2) })}</Ltr></span>
            </div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, marginTop: 10 }}>{t("Payment Method")}</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={payLater} onChange={(e) => setPayLater(e.target.checked)} />
              <span>{t("Pay later — settle when I collect the order")}</span>
            </label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={payLater}
              style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #ddd", marginBottom: 14, opacity: payLater ? 0.5 : 1 }}>
              <option value="cash">{t("Cash")}</option>
              <option value="visa">{t("Visa")}</option>
              <option value="instapay">{t("InstaPay")}</option>
              <option value="wallet">{t("Wallet")}</option>
            </select>
            {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{t(error)}</p>}
            <button
              onClick={confirmOrder}
              disabled={placing}
              style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: theme.navy, color: "#fff", fontWeight: 700, cursor: "pointer", marginBottom: 8 }}
            >
              {placing ? t("Placing Order...") : t("Confirm Order")}
            </button>
            <button onClick={() => setCheckoutOpen(false)} style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
              {t("Back to Shopping")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
