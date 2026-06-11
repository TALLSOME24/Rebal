"use client";

const DEMO_SESSION_KEYS = [
  {
    key: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    permissions: ["swap", "rebalance"],
    expiresBlock: 500000,
    active: true,
  },
  {
    key: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    permissions: ["read"],
    expiresBlock: 450000,
    active: false,
  },
] as const;

function Card({ children, style, className = "" }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${className}`}
      style={{ backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(255,255,255,0.06)", ...style }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)", letterSpacing: "1.4px" }}>
      {children}
    </p>
  );
}

export function Accounts() {
  return (
    <div className="relative space-y-4">
      {/* Coming soon banner */}
      <div
        className="flex items-center gap-3 rounded-2xl border px-4 py-3"
        style={{ backgroundColor: "rgba(91,79,232,0.06)", borderColor: "rgba(91,79,232,0.2)" }}
      >
        <span style={{ color: "#5B4FE8" }}>⬡</span>
        <p className="text-sm" style={{ color: "rgba(91,79,232,0.85)" }}>
          ERC-4337 smart accounts coming in next release — UI preview below uses demo data
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* Session keys */}
          <Card>
            <Label>Session Keys</Label>
            <div className="space-y-2">
              {DEMO_SESSION_KEYS.map((sk) => (
                <div
                  key={sk.key}
                  className="rounded-xl border p-3"
                  style={{ borderColor: "rgba(255,255,255,0.05)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="break-all font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.75)" }}>
                        {sk.key}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {sk.permissions.map((p) => (
                          <span
                            key={p}
                            className="rounded-full px-2 py-0.5 font-mono text-[9px]"
                            style={{ backgroundColor: "rgba(91,79,232,0.15)", color: "#5B4FE8" }}
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={
                        sk.active
                          ? { backgroundColor: "rgba(0,200,150,0.1)", color: "#00C896" }
                          : { backgroundColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }
                      }
                    >
                      {sk.active ? "Active" : "Expired"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                    Expires block {sk.expiresBlock.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* Add session key form */}
          <Card>
            <Label>New Session Key</Label>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Key address (0x…)"
                disabled
                className="w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-40"
                style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
              />
              <input
                type="number"
                placeholder="Expiry block"
                disabled
                className="w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-40"
                style={{ backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)", color: "white" }}
              />
              <button
                type="button"
                disabled
                className="w-full rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                style={{ backgroundColor: "#5B4FE8" }}
              >
                Create Session Key
              </button>
            </div>
          </Card>
        </div>

        {/* Smart Account Info */}
        <div className="space-y-4">
          <Card>
            <Label>Smart Account</Label>
            <div className="space-y-2">
              {[
                { k: "Type", v: "ERC-4337" },
                { k: "Factory", v: "Biconomy V3" },
                { k: "Address", v: "Not deployed" },
                { k: "Bundler", v: "Biconomy" },
                { k: "Paymaster", v: "Not configured" },
              ].map(({ k, v }) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>{k}</span>
                  <span className="font-mono text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>{v}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <Label>Permissions</Label>
            <ul className="space-y-1.5">
              {["swap tokens", "rebalance portfolio", "deposit to yield", "read balances"].map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <span style={{ color: "rgba(255,255,255,0.2)" }}>○</span>
                  <span className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>{p}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
