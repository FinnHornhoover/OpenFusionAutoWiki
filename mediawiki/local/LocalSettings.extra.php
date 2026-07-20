<?php

$wgSitename = 'FusionFall Wiki';
$wgMetaNamespace = 'FusionFall_Wiki';
$wgLanguageCode = 'en';
$wgLocaltimezone = 'America/Chicago';

$wgServer = getenv( 'MEDIAWIKI_SERVER' ) ?: 'http://127.0.0.1:8081';
$wgScriptPath = '';
$wgArticlePath = '/index.php?title=$1';
$wgEnableUploads = true;
$wgMaxUploadSize = 100 * 1024 * 1024;
$wgMaxArticleSize = 2048;
$wgFileExtensions = [ 'png', 'gif', 'jpg', 'jpeg', 'webp' ];

$wgEnableEmail = false;
$wgEnableUserEmail = false;
$wgJobRunRate = 0;
$wgDefaultSkin = 'vector';

wfLoadExtension( 'CategoryTree' );
wfLoadExtension( 'Cite' );
wfLoadExtension( 'CiteThisPage' );
wfLoadExtension( 'CodeEditor' );
wfLoadExtension( 'Echo' );
wfLoadExtension( 'Interwiki' );
wfLoadExtension( 'ParserFunctions' );
wfLoadExtension( 'ImageMap' );
wfLoadExtension( 'InputBox' );
wfLoadExtension( 'TemplateData' );
wfLoadExtension( 'WikiEditor' );
wfLoadExtension( 'MultimediaViewer' );
wfLoadExtension( 'PageImages' );
wfLoadExtension( 'Thanks' );
wfLoadExtension( 'Maps' );
wfLoadExtension( 'TabberNeue' );

$wgTabberNeueEnableAnimation = false;
$wgTabberNeueUpdateLocationOnTabChange = true;
