interface IconProps {
  src: string;
  alt?: string;
  size?: number;
  className?: string;
}

export default function Icon({ src, alt = '', size = 128, className }: IconProps) {
  if (!src) {
    return <span className={`icon icon-empty ${className ?? ''}`} aria-hidden style={{ width: size, height: size }} />;
  }
  const url = src.startsWith('/') ? src : `/icons/${src}`;
  return (
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      className={`icon ${className ?? ''}`}
    />
  );
}
