"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Deliberately un-branded, full-screen, website-style e-commerce page - no
// Al Shrooouk logo or navy header here, unlike the rest of the doctor
// portal. This is meant to feel like a standalone shopping site.
// Small square control for the quantity steppers, sized for a thumb since this
// is used on a phone at the chairside.
const stepBtn = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: "1px solid #ddd",
  background: "#fff",
  color: "#1a1a2e",
  fontSize: 15,
  fontWeight: 700,
  lineHeight: 1,
  cursor: "pointer",
};

export default function DentalStockShopPage() {
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
      setRequestError("Tell us what you need.");
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
      setRequestError(result.error || "Could not send that request.");
      return;
    }
    setRequestSent(true);
  }
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [payLater, setPayLater] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [confirmedOrder, setConfirmedOrder] = useState(null);
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
      setError(result.error || "Something went wrong placing this order.");
      return;
    }
    setConfirmedOrder(result.orderId);
    setOrderSplit({ hasBackorder: !!result.hasBackorder, hasInStock: !!result.hasInStock });
    setCart({});
    setCheckoutOpen(false);
  }

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>Loading...</div>;
  }

  if (confirmedOrder) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: "#f7f7f8" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 40, textAlign: "center", maxWidth: 380, boxShadow: "0 8px 30px rgba(0,0,0,0.08)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{"\u2705"}</div>
          <h2 style={{ margin: "0 0 8px" }}>Order Confirmed</h2>
          <p style={{ color: "#666", fontSize: 14, marginBottom: orderSplit?.hasBackorder ? 12 : 24 }}>
            Your order has been placed and sent to the team for fulfillment.
          </p>
          {orderSplit?.hasBackorder && (
            <p style={{ background: "#fff8e1", border: "1px solid #f0d58c", color: "#8a6d00", fontSize: 13, lineHeight: 1.5, borderRadius: 8, padding: "10px 12px", marginBottom: 24, textAlign: "left" }}>
              {orderSplit.hasInStock
                ? "Some of what you ordered is out of stock, so it has been split into two orders: the available items are being prepared now, and the rest will be delivered once they arrive."
                : "These items are currently out of stock. Your order is recorded and will be delivered once they arrive."}
              {" You can follow both on your portal home page."}
            </p>
          )}
          <button
            onClick={() => setConfirmedOrder(null)}
            style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#1a1a2e", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Continue Shopping
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui", background: "#f7f7f8" }}>
      <div style={{ position: "sticky", top: 0, background: "#fff", borderBottom: "1px solid #eee", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 18 }}>Dental Supplies</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {/* Separate from the cart on purpose: this is not an order. There is no
            such item yet, so there is nothing to price or reserve - it is a
            request for the team to consider stocking it. */}
        <button
          onClick={() => setRequestOpen(true)}
          style={{ padding: "10px 16px", borderRadius: 999, border: "1px solid #1a1a2e", background: "#fff", color: "#1a1a2e", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
        >
          Request an item we don&apos;t list
        </button>
        <button
          onClick={() => setCheckoutOpen(true)}
          disabled={cartCount === 0}
          style={{
            padding: "10px 20px", borderRadius: 999, border: "none", fontWeight: 700, fontSize: 14, cursor: cartCount ? "pointer" : "default",
            background: cartCount ? "#1a1a2e" : "#eee", color: cartCount ? "#fff" : "#999",
          }}
        >
          Cart ({cartCount}) {cartTotal > 0 && `\u2013 ${cartTotal.toFixed(2)} EGP`}
        </button>
        </div>
      </div>

      {requestOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 380, maxWidth: "100%" }}>
            <h3 style={{ marginTop: 0 }}>Request an item</h3>
            <p style={{ fontSize: 12, color: "#666", marginTop: -6 }}>
              Something we don&apos;t carry. We&apos;ll look into sourcing it and get back to you &mdash; this is not an order.
            </p>
            {requestSent ? (
              <>
                <p style={{ fontSize: 14, color: "#1e7a3c", fontWeight: 600 }}>Request sent. Thank you.</p>
                <button onClick={() => { setRequestOpen(false); setRequestSent(false); setReqName(""); setReqQty(""); setReqNote(""); }}
                  style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
                  Close
                </button>
              </>
            ) : (
              <>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Item name</label>
                <input value={reqName} onChange={(e) => setReqName(e.target.value)} placeholder="What do you need?"
                  style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #ddd", margin: "6px 0 12px", boxSizing: "border-box" }} />
                <label style={{ fontSize: 12, fontWeight: 600 }}>Quantity (optional)</label>
                <input type="number" min={1} value={reqQty} onChange={(e) => setReqQty(e.target.value)}
                  style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #ddd", margin: "6px 0 12px", boxSizing: "border-box" }} />
                <label style={{ fontSize: 12, fontWeight: 600 }}>Notes (brand, size, anything that helps)</label>
                <input value={reqNote} onChange={(e) => setReqNote(e.target.value)}
                  style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #ddd", margin: "6px 0 14px", boxSizing: "border-box" }} />
                {requestError && <p style={{ color: "#ba1a1a", fontSize: 12 }}>{requestError}</p>}
                <button onClick={sendRequest} disabled={requestBusy}
                  style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: "#1a1a2e", color: "#fff", fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
                  {requestBusy ? "Sending..." : "Send request"}
                </button>
                <button onClick={() => setRequestOpen(false)}
                  style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 20 }}>
        {items.length === 0 && <p style={{ color: "#666" }}>No items in the catalogue yet.</p>}
        {items.map((item) => (
          <div key={item.id} style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ height: 140, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {item.image_url ? (
                <img src={item.image_url} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ color: "#bbb", fontSize: 12 }}>No image</span>
              )}
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{item.name}</div>
              <div style={{ color: "#1a1a2e", fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{Number(item.sale_price).toFixed(2)} EGP</div>
              {/* The real count, not just a hidden maximum. A doctor ordering
                  supplies needs to know whether we hold 2 or 40 before deciding
                  how much to ask for. */}
              {item.qty_available > 0 ? (
                <div style={{ fontSize: 12, color: "#1e7a3c", fontWeight: 600, marginBottom: 10 }}>
                  {item.qty_available} in stock
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#8a6d00", background: "#fff8e1", border: "1px solid #f0d58c", borderRadius: 6, padding: "6px 8px", marginBottom: 10, lineHeight: 1.4 }}>
                  Currently out of stock &mdash; you can still order it and we will deliver it once it arrives.
                </div>
              )}
              {cart[item.id] ? (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => stepQty(item.id, -1)} aria-label={`Remove one ${item.name}`} style={stepBtn}>&minus;</button>
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
                      aria-label={`Add one ${item.name}`}
                      style={stepBtn}
                    >
                      +
                    </button>
                    <button onClick={() => removeFromCart(item.id)} style={{ ...stepBtn, width: "auto", padding: "0 10px", color: "#8c1d18", borderColor: "#f0c9c9" }}>
                      Remove
                    </button>
                  </div>
                  {item.qty_available > 0 && cart[item.id] >= item.qty_available && (
                    <p style={{ fontSize: 11, color: "#8a6d00", margin: "6px 0 0" }}>
                      That is all we have in stock right now.
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => addToCart(item.id)}
                  style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: "1px solid #1a1a2e", background: "#fff", color: "#1a1a2e", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                >
                  {item.qty_available > 0 ? "Add to Cart" : "Order for later"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {checkoutOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20, padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: 360, maxHeight: "85vh", overflowY: "auto" }}>
            <h3 style={{ marginTop: 0 }}>Checkout</h3>
            {cartLines.length === 0 && (
              <p style={{ fontSize: 13, color: "#666" }}>Your cart is empty. Close this to keep browsing.</p>
            )}
            {cartLines.map((l) => (
              <div key={l.id} style={{ fontSize: 13, padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{l.name}</span>
                  <span>{(Number(l.sale_price) * l.qty).toFixed(2)} EGP</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <button onClick={() => stepQty(l.id, -1)} aria-label={`Remove one ${l.name}`} style={stepBtn}>&minus;</button>
                  <span style={{ minWidth: 22, textAlign: "center" }}>{l.qty}</span>
                  <button onClick={() => stepQty(l.id, 1, l.qty_available > 0 ? l.qty_available : null)} aria-label={`Add one ${l.name}`} style={stepBtn}>+</button>
                  <button onClick={() => removeFromCart(l.id)} style={{ ...stepBtn, width: "auto", padding: "0 10px", color: "#8c1d18", borderColor: "#f0c9c9" }}>
                    Remove
                  </button>
                  {l.qty_available <= 0 && (
                    <span style={{ fontSize: 11, color: "#8a6d00" }}>awaiting stock</span>
                  )}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, padding: "10px 0" }}>
              <span>Total</span>
              <span>{cartTotal.toFixed(2)} EGP</span>
            </div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, marginTop: 10 }}>Payment Method</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={payLater} onChange={(e) => setPayLater(e.target.checked)} />
              <span>Pay later — settle when I collect the order</span>
            </label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={payLater}
              style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #ddd", marginBottom: 14, opacity: payLater ? 0.5 : 1 }}>
              <option value="cash">Cash</option>
              <option value="visa">Visa</option>
              <option value="instapay">InstaPay</option>
              <option value="wallet">Wallet</option>
            </select>
            {error && <p style={{ color: "#ba1a1a", fontSize: 13 }}>{error}</p>}
            <button
              onClick={confirmOrder}
              disabled={placing}
              style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: "#1a1a2e", color: "#fff", fontWeight: 700, cursor: "pointer", marginBottom: 8 }}
            >
              {placing ? "Placing Order..." : "Confirm Order"}
            </button>
            <button onClick={() => setCheckoutOpen(false)} style={{ width: "100%", padding: "10px 0", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
              Back to Shopping
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
