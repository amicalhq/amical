cask "amical" do
  arch arm: "arm64", intel: "x64"

  version "0.1.15"
  sha256 arm:   "a56bb507107b81e0ea384319efaf8bae1ffa3a2646fa11d6d8263b1213f1d515",
         intel: "115dc4dbbd81800136d85ac817e5756fdc995cd27a0f73b553433c63b822d21f"

  url "https://github.com/amicalhq/amical/releases/download/v#{version}/Amical-#{version}-#{arch}.dmg",
      verified: "github.com/amicalhq/amical/"
  name "Amical"
  desc "AI dictation app - open source and local-first"
  homepage "https://github.com/amicalhq/amical"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "Amical.app"

  zap trash: [
    "~/Library/Application Support/Amical",
    "~/Library/Caches/Amical",
    "~/Library/Preferences/com.amical.app.plist",
    "~/Library/Saved Application State/com.amical.app.savedState",
  ]
end