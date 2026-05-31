import { Link, useParams } from 'react-router-dom';

import Minimap from './Minimap';

interface MapSpotPoint {
  x: number;
  y: number;
  icon?: string;
}

interface MapSpotProps {
  x: number;
  y: number;
  z?: number;
  areaId?: string;
  title?: string;
  instanceName?: string;
  instanceID?: number;
  points?: MapSpotPoint[];
  size?: number;
  extent?: number;
  icon?: string;
}

export default function MapSpot({
  x,
  y,
  z = 0,
  areaId = '',
  title,
  instanceName = '',
  instanceID = 0,
  points = [],
  size = 256,
  extent,
  icon,
}: MapSpotProps) {
  const { build = '' } = useParams();
  const areaLabel = title && title !== 'Unknown - Unknown' ? <span className="map-spot-area">{title}</span> : null;
  const instanceLabel = instanceName
    ? <span className="map-spot-instance">{instanceName}</span>
    : instanceID > 0 ? <span className="map-spot-instance">Instance {instanceID}</span> : null;
  const map = <Minimap x={x} y={y} size={size} extent={extent} points={points} icon={icon} title={title} />;
  const coordinates = <span className="map-spot-coordinates">({x}, {y}, {z})</span>;
  const content = (
    <>
      {areaLabel}
      {instanceLabel}
      {map}
      {coordinates}
    </>
  );
  const linkTarget = build
    ? instanceID > 0
      ? `/${build}/instances/${instanceID}`
      : areaId ? `/${build}/areas/${areaId}` : ''
    : '';

  return (
    <span className="map-spot">
      {linkTarget ? (
        <Link className="map-spot-link" to={linkTarget}>
          {content}
        </Link>
      ) : content}
    </span>
  );
}
