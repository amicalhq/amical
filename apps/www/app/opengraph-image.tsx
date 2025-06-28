import { ImageResponse } from "next/og";
import { Geist } from "next/font/google";
import { join } from "path";
import { readFileSync } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-static";

export const alt = "Amical - Open Source AI Dictation App";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

const geist = Geist({
  weight: "400",
  subsets: ["latin"],
});

export default async function Image() {
  const logoPath = join(process.cwd(), "public", "amical-icon@2x.png");
  const logoData = readFileSync(logoPath);
  const logoBase64 = `data:image/png;base64,${logoData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          background: " #000000",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px",
        }}
      >
        <img
          src={logoBase64}
          alt="Amical Logo"
          style={{
            width: "400px",
            marginBottom: "32px",
          }}
        />
        <div
          style={{
            fontSize: 38,
            color: "#a0a0a0",
            textAlign: "center",
            maxWidth: "800px",
            fontFamily: geist.style.fontFamily,
          }}
        >
          Open Source AI Dictation App
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
