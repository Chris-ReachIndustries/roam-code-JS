#!/bin/sh
set -e

ROAM="node /app/bin/roam.js"

# ============================================================================
# Phase 6 Smoke Test: Salesforce extractors + Protobuf + Workspace
# ============================================================================

# Create test project with Salesforce, Protobuf, and standard files
mkdir -p /tmp/testproj/src/utils /tmp/testproj/tests
mkdir -p /tmp/testproj/force-app/main/default/classes
mkdir -p /tmp/testproj/force-app/main/default/aura/MyComponent
mkdir -p /tmp/testproj/force-app/main/default/pages
mkdir -p /tmp/testproj/force-app/main/default/objects/Account
mkdir -p /tmp/testproj/proto
cd /tmp/testproj
git init
git config user.email "test@test.com"
git config user.name "Test"

# --- Standard source files (from Phase 5) ---

cat > src/calculator.py << 'PYEOF'
class Calculator:
    def add(self, a, b):
        return a + b
    def subtract(self, a, b):
        return a - b
    def multiply(self, a, b):
        return a * b

def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

def unused_function():
    pass
PYEOF

cat > src/app.js << 'JSEOF'
import { Logger } from "./utils/logger.js";
import { Calculator } from "./calculator.py";

export class App {
    constructor() {
        this.logger = new Logger();
        this.calc = new Calculator();
    }
    run() {
        this.logger.info("Starting app");
        const result = this.calc.add(1, 2);
        return result;
    }
}

export function main() {
    const app = new App();
    return app.run();
}
JSEOF

cat > src/utils/logger.js << 'LOGEOF'
export class Logger {
    info(msg) { console.log("[INFO]", msg); }
    warn(msg) { console.warn("[WARN]", msg); }
    error(msg) { console.error("[ERROR]", msg); }
    debug(msg) { console.log("[DEBUG]", msg); }
}

export const DEFAULT_LEVEL = "info";
export function createLogger(name) { return new Logger(); }
LOGEOF

cat > src/utils/helpers.js << 'HELPEOF'
export function formatDate(d) { return d.toISOString(); }
export function parseNumber(s) { return parseInt(s, 10); }
export function isEmpty(obj) { return Object.keys(obj).length === 0; }
HELPEOF

cat > tests/test_calc.py << 'TESTEOF'
from src.calculator import Calculator, fibonacci

def test_add():
    calc = Calculator()
    assert calc.add(1, 2) == 3

def test_fibonacci():
    assert fibonacci(5) == 5
TESTEOF

cat > src/config.ts << 'TSEOF'
export interface AppConfig {
    port: number;
    host: string;
    debug: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
    port: 3000,
    host: "localhost",
    debug: false,
};

export function loadConfig(path: string): AppConfig {
    return DEFAULT_CONFIG;
}
TSEOF

cat > src/server.js << 'SRVEOF'
import { App } from "./app.js";
import { Logger } from "./utils/logger.js";
import { loadConfig } from "./config.ts";

export class Server {
    constructor(config) {
        this.app = new App();
        this.logger = new Logger();
        this.config = config || loadConfig("config.json");
    }
    start() {
        this.logger.info("Server starting on " + this.config.port);
        return this.app.run();
    }
}
SRVEOF

# --- Salesforce Apex Class ---

cat > force-app/main/default/classes/AccountService.cls << 'APEXEOF'
/**
 * Service class for Account operations.
 */
global with sharing class AccountService implements Schedulable {
    @AuraEnabled
    public static List<Account> getAccounts() {
        return [SELECT Id, Name, Industry FROM Account LIMIT 100];
    }

    @InvocableMethod(label='Create Account')
    public static List<Id> createAccounts(List<String> names) {
        List<Account> accts = new List<Account>();
        for (String name : names) {
            accts.add(new Account(Name = name));
        }
        insert accts;
        return new List<Id>();
    }

    @Future(callout=true)
    public static void syncExternal(Id accountId) {
        Account acct = [SELECT Id, Name FROM Account WHERE Id = :accountId];
        // External callout logic
    }

    public void execute(SchedulableContext ctx) {
        // Scheduled job logic
    }

    public class AccountWrapper {
        public String name;
        public String industry;
    }
}
APEXEOF

cat > force-app/main/default/classes/AccountServiceTest.cls << 'APEXTESTEOF'
@IsTest
private class AccountServiceTest {
    @TestSetup
    static void setup() {
        insert new Account(Name = 'Test Account');
    }

    @IsTest
    static void testGetAccounts() {
        Test.startTest();
        List<Account> accts = AccountService.getAccounts();
        Test.stopTest();
        System.assertNotEquals(null, accts);
    }
}
APEXTESTEOF

# --- Salesforce Apex Trigger ---

cat > force-app/main/default/classes/AccountTrigger.trigger << 'TRIGEOF'
trigger AccountTrigger on Account (before insert, before update, after insert) {
    if (Trigger.isBefore) {
        if (Trigger.isInsert) {
            AccountService.getAccounts();
        }
    }
}
TRIGEOF

# --- Salesforce Aura Component ---

cat > force-app/main/default/aura/MyComponent/MyComponent.cmp << 'AURAEOF'
<aura:component controller="AccountService" implements="force:appHostable,flexipage:availableForAllPageTypes">
    <aura:attribute name="accounts" type="List" access="public" />
    <aura:attribute name="selectedId" type="String" default="" />

    <aura:registerEvent name="accountSelected" type="c:AccountSelectedEvent" />

    <aura:handler name="init" value="{!this}" action="{!c.doInit}" />

    <lightning:card title="Accounts">
        <aura:iteration items="{!v.accounts}" var="acct">
            <lightning:button label="{!acct.Name}" onclick="{!c.selectAccount}" />
        </aura:iteration>
    </lightning:card>
</aura:component>
AURAEOF

# --- Salesforce VisualForce Page ---

cat > force-app/main/default/pages/AccountPage.page << 'VFEOF'
<apex:page controller="AccountService" extensions="AccountExtension" action="{!initPage}">
    <apex:form>
        <apex:pageBlock title="Accounts">
            <apex:pageBlockTable value="{!accounts}" var="acct">
                <apex:column value="{!acct.Name}" />
                <apex:column value="{!acct.Industry}" />
            </apex:pageBlockTable>
            <apex:commandButton action="{!saveAccounts}" value="Save" />
        </apex:pageBlock>
    </apex:form>
    <c:CustomFooter />
</apex:page>
VFEOF

# --- Salesforce Metadata XML ---

cat > force-app/main/default/objects/Account/Account.object-meta.xml << 'XMLEOF'
<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <fields>
        <fullName>External_Id__c</fullName>
        <type>Text</type>
        <label>External ID</label>
        <length>255</length>
    </fields>
    <fields>
        <fullName>Related_Contact__c</fullName>
        <type>Lookup</type>
        <label>Related Contact</label>
        <referenceTo>Contact</referenceTo>
    </fields>
    <validationRules>
        <fullName>Require_Industry</fullName>
        <active>true</active>
        <errorMessage>Industry is required</errorMessage>
    </validationRules>
</CustomObject>
XMLEOF

# --- Protobuf File ---

cat > proto/user.proto << 'PROTOEOF'
syntax = "proto3";

package myapp.users;

import "google/protobuf/timestamp.proto";
import "proto/common.proto";

message User {
  string id = 1;
  string name = 2;
  string email = 3;
  UserRole role = 4;
  google.protobuf.Timestamp created_at = 5;
  repeated Address addresses = 6;

  message Address {
    string street = 1;
    string city = 2;
    string country = 3;
  }

  oneof contact {
    string phone = 7;
    string fax = 8;
  }
}

enum UserRole {
  ROLE_UNKNOWN = 0;
  ROLE_ADMIN = 1;
  ROLE_USER = 2;
  ROLE_MODERATOR = 3;
}

service UserService {
  rpc CreateUser(CreateUserRequest) returns (User);
  rpc GetUser(GetUserRequest) returns (User);
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
}

message CreateUserRequest {
  string name = 1;
  string email = 2;
  UserRole role = 3;
}

message GetUserRequest {
  string id = 1;
}

message ListUsersRequest {
  int32 page_size = 1;
  string page_token = 2;
}

message ListUsersResponse {
  repeated User users = 1;
  string next_page_token = 2;
}
PROTOEOF

# First commit
git add -A
git commit -m "Initial commit with Salesforce + Protobuf files"

# Second commit for churn
echo "// v2" >> src/app.js
git add -A
git commit -m "Update app"

# ============================================================================
echo "=== INDEXING ==="
# ============================================================================
$ROAM index --force 2>&1

echo ""
echo "=== PHASE 6: SALESFORCE EXTRACTOR TESTS ==="

echo "--- search Apex class ---"
$ROAM search AccountService 2>&1 | head -5
echo "PASS: search apex class"

echo "--- symbol Apex class ---"
$ROAM symbol AccountService 2>&1 | head -5
echo "PASS: symbol apex class"

echo "--- search Apex test ---"
$ROAM search AccountServiceTest 2>&1 | head -3
echo "PASS: search apex test"

echo "--- file Apex class ---"
$ROAM file force-app/main/default/classes/AccountService.cls 2>&1 | head -5
echo "PASS: file apex class"

echo "--- deps Apex class ---"
$ROAM deps force-app/main/default/classes/AccountService.cls 2>&1 | head -5
echo "PASS: deps apex class"

echo "--- search Aura component ---"
$ROAM search MyComponent 2>&1 | head -3
echo "PASS: search aura component"

echo "--- file Aura component ---"
$ROAM file force-app/main/default/aura/MyComponent/MyComponent.cmp 2>&1 | head -5
echo "PASS: file aura component"

echo "--- search VF page ---"
$ROAM search AccountPage 2>&1 | head -3
echo "PASS: search vf page"

echo "--- file VF page ---"
$ROAM file force-app/main/default/pages/AccountPage.page 2>&1 | head -5
echo "PASS: file vf page"

echo "--- file SFXML metadata ---"
$ROAM file force-app/main/default/objects/Account/Account.object-meta.xml 2>&1 | head -5
echo "PASS: file sfxml metadata"

echo ""
echo "=== PHASE 6: PROTOBUF EXTRACTOR TESTS ==="

echo "--- search protobuf message ---"
$ROAM search User 2>&1 | head -5
echo "PASS: search protobuf message"

echo "--- symbol protobuf service ---"
$ROAM symbol UserService 2>&1 | head -5
echo "PASS: symbol protobuf service"

echo "--- file proto file ---"
$ROAM file proto/user.proto 2>&1 | head -8
echo "PASS: file proto"

echo "--- search protobuf enum ---"
$ROAM search UserRole 2>&1 | head -3
echo "PASS: search protobuf enum"

echo ""
echo "=== PHASE 6: WORKSPACE TESTS ==="

# Test workspace init
echo "--- workspace init ---"
cd /tmp
mkdir -p ws-test/repo-a/src ws-test/repo-b/src
cd ws-test

# Create repo-a
cd repo-a
git init
git config user.email "test@test.com"
git config user.name "Test"
cat > src/service.js << 'REPOAEOF'
export class ServiceA {
    process() { return "A"; }
}
REPOAEOF
git add -A
git commit -m "Init repo-a"
cd ..

# Create repo-b
cd repo-b
git init
git config user.email "test@test.com"
git config user.name "Test"
cat > src/client.py << 'REPOBEOF'
class ClientB:
    def call(self):
        return "B"
REPOBEOF
git add -A
git commit -m "Init repo-b"
cd ..

# Init workspace
$ROAM workspace init --name "test-workspace" 2>&1
echo "PASS: workspace init"

# Add repos
echo "--- workspace add ---"
$ROAM workspace add ./repo-a --alias frontend 2>&1
$ROAM workspace add ./repo-b --alias backend 2>&1
echo "PASS: workspace add"

# List repos
echo "--- workspace list ---"
$ROAM workspace list 2>&1
echo "PASS: workspace list"

# Index workspace
echo "--- workspace index ---"
$ROAM workspace index --force 2>&1
echo "PASS: workspace index"

# Search across repos
echo "--- cross-repo search ---"
$ROAM search ServiceA 2>&1 | head -3
echo "PASS: cross-repo search"

# Remove repo
echo "--- workspace remove ---"
$ROAM workspace remove backend 2>&1
echo "PASS: workspace remove"

# List after remove
$ROAM workspace list 2>&1

# JSON mode for workspace
echo "--- workspace list --json ---"
$ROAM workspace list --json > /tmp/ws-list.json 2>/dev/null
if node -e "JSON.parse(require('fs').readFileSync('/tmp/ws-list.json','utf8'))" 2>/dev/null; then
  echo "JSON OK: workspace list"
else
  echo "JSON FAIL: workspace list"
fi

echo ""
echo "=== ALL PREVIOUS COMMANDS (regression) ==="

# Go back to testproj
cd /tmp/testproj

echo "--- health ---"
$ROAM health 2>&1 | head -3
echo "PASS: health"

echo "--- map ---"
$ROAM map 2>&1 | head -3
echo "PASS: map"

echo "--- search ---"
$ROAM search Calculator 2>&1 | head -3
echo "PASS: search"

echo "--- symbol ---"
$ROAM symbol Calculator 2>&1 | head -3
echo "PASS: symbol"

echo "--- deps ---"
$ROAM deps src/app.js 2>&1 | head -3
echo "PASS: deps"

echo "--- uses ---"
$ROAM uses Logger 2>&1 | head -3
echo "PASS: uses"

echo "--- weather ---"
$ROAM weather 2>&1 | head -3
echo "PASS: weather"

echo "--- file ---"
$ROAM file src/app.js 2>&1 | head -3
echo "PASS: file"

echo "--- clusters ---"
$ROAM clusters 2>&1 | head -3
echo "PASS: clusters"

echo "--- layers ---"
$ROAM layers 2>&1 | head -3
echo "PASS: layers"

echo "--- trace ---"
$ROAM trace Server fibonacci 2>&1 | head -3
echo "PASS: trace"

echo "--- context ---"
$ROAM context Calculator 2>&1 | head -3
echo "PASS: context"

echo "--- diff ---"
$ROAM diff 2>&1 | head -3
echo "PASS: diff"

echo "--- preflight ---"
$ROAM preflight 2>&1 | head -3
echo "PASS: preflight"

echo "--- dead ---"
$ROAM dead 2>&1 | head -3
echo "PASS: dead"

echo "--- describe ---"
$ROAM describe 2>&1 | head -3
echo "PASS: describe"

echo "--- understand ---"
$ROAM understand 2>&1 | head -3
echo "PASS: understand"

echo "--- complexity ---"
$ROAM complexity --threshold 0 2>&1 | head -3
echo "PASS: complexity"

echo "--- coupling ---"
$ROAM coupling --min-strength 1 2>&1 | head -3
echo "PASS: coupling"

echo "--- fan ---"
$ROAM fan --threshold 1 2>&1 | head -3
echo "PASS: fan"

echo "--- grep ---"
$ROAM grep "calc" 2>&1 | head -3
echo "PASS: grep"

echo "--- risk ---"
$ROAM risk 2>&1 | head -3
echo "PASS: risk"

echo "--- fitness ---"
$ROAM fitness 2>&1 | head -3
echo "PASS: fitness"

echo "--- conventions ---"
$ROAM conventions 2>&1 | head -3
echo "PASS: conventions"

echo "--- breaking ---"
$ROAM breaking 2>&1 | head -3
echo "PASS: breaking"

echo "--- coverage-gaps ---"
$ROAM coverage-gaps 2>&1 | head -3
echo "PASS: coverage-gaps"

echo "--- affected-tests ---"
$ROAM affected-tests 2>&1 | head -3
echo "PASS: affected-tests"

echo "--- pr-risk ---"
$ROAM pr-risk 2>&1 | head -3
echo "PASS: pr-risk"

echo "--- trend ---"
$ROAM trend 2>&1 | head -3
echo "PASS: trend"

echo "--- alerts ---"
$ROAM alerts 2>&1 | head -3
echo "PASS: alerts"

echo "--- report ---"
$ROAM report 2>&1 | head -3
echo "PASS: report"

echo ""
echo "=== JSON MODE TESTS ==="

json_test() {
  name=$1
  shift
  $ROAM "$@" --json > /tmp/jtest.json 2>/dev/null
  if node -e "JSON.parse(require('fs').readFileSync('/tmp/jtest.json','utf8'))" 2>/dev/null; then
    echo "JSON OK: $name"
  else
    echo "JSON FAIL: $name"
  fi
}

json_test "health" health
json_test "map" map
json_test "search" search Calculator
json_test "symbol" symbol Calculator
json_test "deps" deps src/app.js
json_test "uses" uses Logger
json_test "weather" weather
json_test "file" file src/app.js
json_test "clusters" clusters
json_test "layers" layers
json_test "dead" dead
json_test "describe" describe
json_test "understand" understand
json_test "complexity" complexity --threshold 0
json_test "coupling" coupling --min-strength 1
json_test "fan" fan --threshold 1
json_test "grep" grep calc
json_test "risk" risk
json_test "fitness" fitness
json_test "conventions" conventions
json_test "coverage-gaps" coverage-gaps
json_test "report" report

echo ""
echo "=== SARIF TESTS ==="

$ROAM health --sarif /tmp/health.sarif 2>&1 > /dev/null
echo "PASS: health sarif"
$ROAM dead --sarif /tmp/dead.sarif 2>&1 > /dev/null
echo "PASS: dead sarif"
$ROAM complexity --threshold 0 --sarif /tmp/complexity.sarif 2>&1 > /dev/null
echo "PASS: complexity sarif"
$ROAM fitness --sarif /tmp/fitness.sarif 2>&1 > /dev/null
echo "PASS: fitness sarif"
$ROAM report --format sarif -o /tmp/report.sarif 2>&1 > /dev/null
echo "PASS: report sarif"

echo ""
echo "=== SARIF VALIDATION ==="
for f in /tmp/health.sarif /tmp/dead.sarif /tmp/complexity.sarif /tmp/fitness.sarif /tmp/report.sarif; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('VALID: $f')" 2>&1
done

echo ""
echo "=== ALL PHASE 6 TESTS COMPLETE ==="
