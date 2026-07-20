FROM python:3.12-slim

RUN pip install --no-cache-dir wikiteam3==4.3.3

COPY mediawiki/local/snapshot.sh /usr/local/bin/ofaw-mediawiki-snapshot
RUN chmod +x /usr/local/bin/ofaw-mediawiki-snapshot

ENTRYPOINT ["ofaw-mediawiki-snapshot"]
