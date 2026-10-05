<?php
// Copy to radar-config.php OUTSIDE public_html and fill in the token. Never put this file inside the website's public folder
// and never commit the real one. The token should be a fine-grained GitHub token for this one repository with only
// "Actions: Read and write" (it can start the collector and do nothing else).
return [
    'token'    => 'PASTE_THE_TOKEN_HERE',
    'owner'    => 'amitvprabhu-lang',
    'repo'     => 'Radar-around-you',
    'workflow' => 'live-data.yml',
    'ref'      => 'main',
];
