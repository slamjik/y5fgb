import type React from "react";

export const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--glass-fill-base)",
  borderColor: "var(--glass-border)",
  backdropFilter: "blur(20px)",
};

export const innerCardStyle: React.CSSProperties = {
  backgroundColor: "rgba(20, 20, 20, 0.52)",
  borderColor: "var(--glass-border)",
};

export const selectedCardStyle: React.CSSProperties = {
  backgroundColor: "rgba(60, 70, 92, 0.42)",
  borderColor: "var(--accent-brown)",
};

export const outlineButtonStyle: React.CSSProperties = {
  borderColor: "var(--accent-brown)",
  color: "var(--accent-brown)",
};

export const solidButtonStyle: React.CSSProperties = {
  borderColor: "var(--accent-brown)",
  backgroundColor: "var(--accent-brown)",
  color: "var(--core-background)",
};

