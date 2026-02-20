This is a historical events research database that i want to eventually be a wiki style database that people can use save research and do their own. i want it to be a all in 1 or home base that people can use to find info about controversial or censored topics instead of having to search across dozens of places across the web.
It's built with Frontend Framework

React 18.2 (UMD build via CDN) with ReactDOM
Babel Standalone 7.23.5 — transpiles JSX in-browser (no build step)
Visualization Libraries

vis-network 9.1.6 — graph/network visualization (for relationship/network view)
Data Utilities

SheetJS (xlsx) 0.18.5 — Excel/spreadsheet file parsing and export
Styling

Plain CSS (inline <style> block, no CSS framework)
Google Fonts — Space Mono and Karla typefaces
Architecture

Single-file HTML app — all JS, CSS, and markup in one .html file
No bundler, no npm, no build process — everything loaded from CDNs at runtime

I'm currently working on updating the filters section and cleaning up the repeat data. 
Known issues: there are a few current issues: the first is in the 'network' view, the network view takes a while to load when any filter is applied. even worse is when ther is a topic searched through the manual typed search it creates a jumbled mess of connections that is moving arround rappidly effectivly spazing out making it unreadable and unusable.
the files in the folder are different saved versions, with the most recent version being the v2.2. these are basically in saved order.
the next major features are: ai analysis of 'uploads' of videos or documents where ai watches or views the entire video and pulls info from the source. often these are URl 'uploads' to youtube videos so ai will need to open the url and watch the video. another major feature is a user login and admin page. another is a presentations capablity so that people can create presentations based on the data. lastly is a overall UI overhaul to make it more visually appealing and easy to use, with a focus on the timeline and network UI. 
