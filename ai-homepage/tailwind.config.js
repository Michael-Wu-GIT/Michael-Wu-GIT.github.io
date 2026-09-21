module.exports = {
  content: [
    "./ai-homepage/index.html",
    "./ai-homepage/case-agent.html",
    "./ai-homepage/case-prompt.html",
    "./ai-homepage/case-deploy.html"
  ],
  theme: {
    extend: {
      colors: {
        night: "#0A0F1E",
        panel: "#111827",
        line: "#1F2937",
        accent: "#22D3EE",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Noto Sans SC",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
