import { ImageResponse } from "next/og";

/** The card X, Telegram and others show for a link to the app. */
export const alt = "Yield AI Agent: your yield pays for your private AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CHIPS = ["Private AI in a verified TEE", "Earns on your USDC", "Deposit from any chain"];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          color: "#e8eef7",
          fontFamily: "sans-serif",
          backgroundColor: "#05070d",
          backgroundImage:
            "radial-gradient(circle at 85% 0%, rgba(77,141,255,0.4), transparent 55%), radial-gradient(circle at 0% 100%, rgba(139,92,246,0.32), transparent 50%)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 30, color: "#8b9bb3" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", width: 18, height: 18, borderRadius: 9, background: "#34d399", marginRight: 16 }} />
            Yield AI Agent
          </div>
          <div style={{ display: "flex", fontSize: 26 }}>NEAR AI Cloud · NEAR Intents</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            Your yield pays for
          </div>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, color: "#7fb0ff" }}>
            your private AI.
          </div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 32, color: "#b6c3d6" }}>
            An advisor nobody but you can read, not even us.
          </div>
        </div>
        <div style={{ display: "flex" }}>
            {CHIPS.map((chip) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  marginRight: 14,
                  padding: "10px 20px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.05)",
                  fontSize: 26,
                }}
              >
                {chip}
              </div>
            ))}
        </div>
      </div>
    ),
    size
  );
}
