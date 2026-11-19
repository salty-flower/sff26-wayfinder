#!/usr/bin/env nu
# Build the wayfinder into dist/, and optionally publish it to Cloudflare Pages.
#
#   nu build.nu            build only
#   nu build.nu --deploy   build, then publish if anything changed
#
# The only inputs are the organiser's floor plan and walkway graph (see src/config.ts).
#
# Publishing needs two settings, read from the environment or from an untracked .env file
# beside this script (see .env.example); the environment wins:
#   WAYFINDER_PAGES_PROJECT   name of the Cloudflare Pages project; the site is served at
#                             <name>.pages.dev unless that address is taken
#   CLOUDFLARE_ACCOUNT_ID     only needed when the wrangler login can reach several accounts

def need [cmd: string] {
    if (which $cmd | is-empty) {
        error make {msg: $"`($cmd)` is not on PATH"}
    }
}

# Run an external command, show what it printed, and return the captured result.
def --wrapped passthrough [cmd: string, ...args: string] {
    let r = (do { ^$cmd ...$args } | complete)
    if ($r.stdout | is-not-empty) { print --no-newline $r.stdout }
    if ($r.stderr | is-not-empty) { print --stderr --no-newline $r.stderr }
    $r
}

# KEY=value lines of .env, without the keys the environment already sets.
def local-settings [] {
    if not (".env" | path exists) { return {} }
    let known = ($env | columns)
    open --raw .env
    | lines
    | each {|line| $line | str trim }
    | where {|line| ($line | is-not-empty) and (not ($line | str starts-with "#")) and ($line | str contains "=") }
    | each {|line|
        let parts = ($line | split row --number 2 "=")
        {key: ($parts.0 | str trim), value: ($parts.1 | str trim | str trim --char '"')}
    }
    | where {|pair| ($pair.key not-in $known) and ($pair.value | is-not-empty) }
    | reduce --fold {} {|pair, acc| $acc | upsert $pair.key $pair.value }
}

def build-pages [] {
    need bun
    if not ("node_modules/nunjucks" | path exists) {
        print "installing dependencies"
        let r = (passthrough bun install --frozen-lockfile)
        if $r.exit_code != 0 {
            error make {msg: "bun install failed"}
        }
    }
    let r = (passthrough bun run src/build.ts)
    if $r.exit_code != 0 {
        error make {msg: "build failed; dist/ was left as it was"}
    }
    if not ("dist/index.html" | path exists) {
        error make {msg: "build reported success but dist/index.html is missing"}
    }
    # The site has no server code. A stray functions/ folder would be deployed with it.
    if ("functions" | path exists) {
        error make {msg: "functions/ exists; this project ships static files only"}
    }
    open .cache/last-build.json
}

# Create the Pages project when it is missing; return the address Cloudflare gave it.
def ensure-project [project: string] {
    let list = {||
        let listed = (do { ^wrangler pages project list --json } | complete)
        if $listed.exit_code != 0 {
            error make {msg: $"could not list Pages projects:\n($listed.stderr)"}
        }
        $listed.stdout | from json
    }
    mut found = (do $list | where "Project Name" == $project)
    if ($found | is-empty) {
        print $"creating Pages project ($project)"
        # Without --force, recent wrangler versions hand the request to Workers, which wants an entry point and creates nothing.
        let r = (passthrough wrangler pages project create $project --production-branch main --force)
        if $r.exit_code != 0 {
            error make {msg: $"could not create Pages project ($project)"}
        }
        $found = (do $list | where "Project Name" == $project)
    }
    let domain = ($found | get "Project Domains" | get 0? | default "" | split row "," | get 0 | str trim)
    if ($domain | is-empty) {
        error make {msg: $"Pages project ($project) has no address"}
    }
    $"https://($domain)"
}

def publish [info: record, project: string, force: bool] {
    need wrangler
    let marker = ".cache/deployed-id"
    if (not $force) and ($marker | path exists) and ((open --raw $marker | str trim) == $"($project) ($info.id)") {
        print $"build ($info.id) is already live, nothing to deploy [--force redeploys]"
        return
    }
    let site = (ensure-project $project)
    # Branch, hash and message are given explicitly so wrangler takes nothing from the git repository around it.
    let args = [
        pages deploy dist
        --project-name $project
        --branch main
        --commit-hash $info.hash
        --commit-message $"wayfinder build ($info.id)"
        --commit-dirty=true
    ]
    let r = (passthrough wrangler ...$args)
    if $r.exit_code != 0 {
        error make {msg: "wrangler pages deploy failed; the previous deployment is still live"}
    }
    # The new build must be the one answering, must ask crawlers to stay away and must set no cookie.
    # A brand-new project answers 5xx for a short while, so that case is retried.
    mut page = {status: 0, headers: {response: []}, body: ""}
    for attempt in 1..24 {
        $page = (try { http get --full --allow-errors --max-time 20sec $"($site)/" } catch { {status: 0, headers: {response: []}, body: ""} })
        if $page.status == 200 and ($page.body | into string | str contains $info.id) { break }
        sleep 5sec
    }
    if $page.status != 200 or not ($page.body | into string | str contains $info.id) {
        error make {msg: $"check failed: ($site)/ answered ($page.status) and does not carry build ($info.id) yet"}
    }
    let headers = ($page.headers.response | each {|h| {name: ($h.name | str lowercase), value: $h.value} })
    let robots = ($headers | where name == "x-robots-tag" | get value | get 0? | default "")
    if not ($robots | str contains "noindex") {
        error make {msg: $"check failed: ($site)/ is missing X-Robots-Tag: noindex"}
    }
    if ($headers | where name == "set-cookie" | is-not-empty) {
        error make {msg: $"check failed: ($site)/ sets a cookie"}
    }
    $site | save --force .cache/site-url
    $"($project) ($info.id)" | save --force $marker
    print $"deployed build ($info.id) to ($site) [noindex header present, no cookie set]"
}

def main [
    --deploy  # publish to Cloudflare Pages after building
    --force   # with --deploy: publish even when this build id is already live
] {
    cd $env.FILE_PWD
    load-env (local-settings)
    let project = ($env.WAYFINDER_PAGES_PROJECT? | default "" | str trim)
    if $deploy and ($project | is-empty) {
        print --stderr "build.nu: set WAYFINDER_PAGES_PROJECT in the environment or in .env before deploying [see .env.example]"
        exit 1
    }

    mkdir .cache
    let lock = ".cache/build.lock"
    if ($lock | path exists) {
        let age = ((date now) - (ls --directory $lock | get 0.modified))
        if $age < 10min {
            print --stderr $"build.nu: another build is running [lock: ($lock)]"
            exit 1
        }
        rm --recursive --force $lock
    }
    mkdir $lock

    let outcome = (try {
        let info = (build-pages)
        if $deploy { publish $info $project $force }
        {ok: true, msg: ""}
    } catch {|e|
        {ok: false, msg: $e.msg}
    })

    rm --recursive --force $lock
    if not $outcome.ok {
        print --stderr $"build.nu: ($outcome.msg)"
        exit 1
    }
}
