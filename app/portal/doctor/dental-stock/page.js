"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Deliberately un-branded, full-screen, website-style e-commerce page - no
// Al Shrooouk logo or navy header here, unlike the rest of the doctor
// portal. This is meant to feel like a standalone shopping site.
export default function DentalStockShopPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState({}); // { stock_item_id: quantity }
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
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
          <div style={{ fontSize: 40, marginBottom: 12 }}>\u2705</div>
          <h2 style={{ margin: "0 0 8px" }}>Order Confirmed</h2>
          <p style={{ color: "#666", fontSize: 14, marginBottom: 24 }}>Your order has been placed and sent to the team for fulfillment.</p>
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

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 20 }}>
        {items.length === 0 && <p style={{ color: "#666" }}>No items currently available.</p>}
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
              <div style={{ color: "#1a1a2e", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{Number(item.sale_price).toFixed(2)} EGP</div>
              {cart[item.id] ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    max={item.qty_remaining}
                    value={cart[item.id]}
                    onChange={(e) => setQty(item.id, e.target.value)}
                    style={{ width: 60, padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd" }}
                  />
                  <span style={{ fontSize: 12, color: "#999" }}>in cart</span>
                </div>
              ) : (
                <button
                  onClick={() => addToCart(item.id)}
                  style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: "1px solid #1a1a2e", background: "#fff", color: "#1a1a2e", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                >
                  Add to Cart
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
            {cartLines.map((l) => (
              <div key={l.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
                <span>{l.name} \u00d7 {l.qty}</span>
                <span>{(Number(l.sale_price) * l.qty).toFixed(2)} EGP</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, padding: "10px 0" }}>
              <span>Total</span>
              <span>{cartTotal.toFixed(2)} EGP</span>
            </div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, marginTop: 10 }}>Payment Method</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #ddd", marginBottom: 14 }}>
              <option value="cash">Cash</option>
              <option value="visa">Visa</option>
              <option value="instapay">InstaPay</option>
              <option value="vodafone_cash">Vodafone Cash</option>
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
