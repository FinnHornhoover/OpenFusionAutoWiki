import { Link, useParams } from 'react-router-dom';

import Minimap from './Minimap';

interface MapSpotProps {
  x: number;
  y: number;
  z?: number;
  areaId?: string;
  title?: string;
  instanceName?: string;
  instanceID?: number;
  size?: number;
  extent?: number;
}

export default function MapSpot({
  x,
  y,
  z = 0,
  areaId = '',
  title,
  instanceID = 0,
  size = 256,
  extent,
}: MapSpotProps) {
  const { build = '' } = useParams();
  const areaLabel = title && title !== 'Unknown - Unknown' ? <span className="map-spot-area">{title}</span> : null;
  const instanceLabel = instanceID > 0 ? <span className="map-spot-instance">Instance {instanceID}</span> : null;
  const map = <Minimap x={x} y={y} size={size} extent={extent} title={title} />;
  const coordinates = <span className="map-spot-coordinates">({x}, {y}, {z})</span>;
  const content = (
    <>
      {areaLabel}
      {instanceLabel}
      {map}
      {coordinates}
    </>
  );
  const canLink = build && areaId;

  return (
    <span className="map-spot">
      {canLink ? (
        <Link className="map-spot-link" to={`/${build}/areas/${areaId}`}>
          {content}
        </Link>
      ) : content}
    </span>
  );
}
