import React from "react";

export function AuthenticatedImage(props: {
  mediaId: string;
  accessToken: string;
  apiBaseUrl: string;
  apiPrefix: string;
  alt: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const { mediaId, accessToken, apiBaseUrl, apiPrefix, alt, className, fallbackClassName } = props;
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let disposed = false;
    let currentObjectUrl: string | null = null;

    const load = async () => {
      setError("");
      setBlobUrl(null);
      try {
        const endpoint = `${apiBaseUrl}${apiPrefix}/media/${encodeURIComponent(mediaId)}/content`;
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!response.ok) {
          throw new Error("Не удалось загрузить изображение.");
        }
        const blob = await response.blob();
        currentObjectUrl = URL.createObjectURL(blob);
        if (!disposed) {
          setBlobUrl(currentObjectUrl);
        }
      } catch (loadError) {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить изображение.");
        }
      }
    };

    void load();
    return () => {
      disposed = true;
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
      }
    };
  }, [accessToken, apiBaseUrl, apiPrefix, mediaId]);

  if (!blobUrl) {
    return (
      <div className={fallbackClassName ?? className} style={{ background: "linear-gradient(135deg,#2b2f3f,#1a1f29)" }}>
        {error ? (
          <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
            Ошибка загрузки
          </div>
        ) : null}
      </div>
    );
  }

  return <img src={blobUrl} alt={alt} className={className} />;
}

